import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb } from './client.ts';
import { parseRepoName } from './helpers.ts';

export const SCHEMA_VERSION = 19;

export function runMigrations() {
  const db = getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  const row = db.query<{ v: number | null }, []>('SELECT MAX(version) as v FROM schema_version').get();
  const current = row?.v ?? 0;

  if (current < SCHEMA_VERSION) {
    const schemaPath = join(import.meta.dir, 'schema.sql');
    const sql = readFileSync(schemaPath, 'utf8');
    db.transaction(() => {
      db.run(sql);

      // ── v3 migration: extract tasks.repos JSON → repos + task_repos tables ──
      if (current < 3) {
        // Check if the old tasks table still has a repos column
        const cols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('tasks')"
        ).all();
        const hasReposCol = cols.some(c => c.name === 'repos');

        if (hasReposCol) {
          // 1. Extract existing JSON repos into the new repos + task_repos tables
          const rows = db.query<{ id: string; repos: string }, []>(
            'SELECT id, repos FROM tasks'
          ).all();

          for (const row of rows) {
            let urls: string[];
            try {
              urls = JSON.parse(row.repos);
            } catch {
              urls = [];
            }
            if (!Array.isArray(urls)) urls = [];

            for (const url of urls) {
              if (typeof url !== 'string' || url.length === 0) continue;

              const name = parseRepoName(url);
              db.run(
                'INSERT OR IGNORE INTO repos (url, name) VALUES (?, ?)',
                [url, name]
              );
              const repo = db.query<{ id: number }, [string]>(
                'SELECT id FROM repos WHERE url = ?'
              ).get(url);
              if (repo) {
                db.run(
                  'INSERT OR IGNORE INTO task_repos (task_id, repo_id) VALUES (?, ?)',
                  [row.id, repo.id]
                );
              }
            }
          }

          // 2. Recreate tasks table without the repos column
          db.run(`
            CREATE TABLE tasks_new (
              id          TEXT PRIMARY KEY,
              title       TEXT NOT NULL CHECK (length(title) <= 500),
              description TEXT CHECK (description IS NULL OR length(description) <= 10000),
              status      TEXT NOT NULL DEFAULT 'todo'
                            CHECK (status IN ('todo', 'working', 'awaiting_input', 'done')),
              agent       TEXT NOT NULL DEFAULT 'claude-code',
              created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
          `);

          db.run(`
            INSERT INTO tasks_new (id, title, description, status, agent, created_at)
            SELECT id, title, description, status, agent, created_at FROM tasks
          `);

          db.run('DROP TABLE tasks');
          db.run('ALTER TABLE tasks_new RENAME TO tasks');
        }
      }

      // ── v4 migration: add 'prompt' to acp_events.type CHECK constraint ──
      if (current < 4) {
        // SQLite doesn't support ALTER COLUMN, so recreate the table
        const hasEventsTable = db.query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='acp_events'"
        ).get();

        if (hasEventsTable) {
          db.run(`
            CREATE TABLE acp_events_new (
              id         TEXT PRIMARY KEY,
              task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
              session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
              type       TEXT NOT NULL CHECK (type IN ('thought', 'action', 'await_input', 'result', 'prompt')),
              content    TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
          `);

          db.run(`
            INSERT INTO acp_events_new (id, task_id, session_id, type, content, created_at)
            SELECT id, task_id, session_id, type, content, created_at FROM acp_events
          `);

          db.run('DROP TABLE acp_events');
          db.run('ALTER TABLE acp_events_new RENAME TO acp_events');

          db.run('CREATE INDEX IF NOT EXISTS idx_acp_events_task_id ON acp_events(task_id)');
          db.run('CREATE INDEX IF NOT EXISTS idx_acp_events_session_id ON acp_events(session_id)');
        }
      }

      // ── v5 migration: add 'ready' to agent_sessions.state CHECK constraint ──
      if (current < 5) {
        const hasSessionsTable = db.query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_sessions'"
        ).get();

        const sessColsV5 = hasSessionsTable
          ? db.query<{ name: string }, []>("SELECT name FROM pragma_table_info('agent_sessions')").all().map(c => c.name)
          : [];
        if (hasSessionsTable && sessColsV5.includes('task_id')) {
          db.run(`
            CREATE TABLE agent_sessions_new (
              id                  TEXT PRIMARY KEY,
              task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
              agent_type          TEXT NOT NULL,
              name                TEXT DEFAULT NULL,
              external_session_id TEXT,
              pid                 INTEGER,
              state               TEXT NOT NULL DEFAULT 'starting'
                                    CHECK (state IN ('starting', 'ready', 'running', 'stopped', 'crashed', 'interrupted')),
              started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
              ended_at            TEXT,
              exit_code           INTEGER
            )
          `);

          db.run(`
            INSERT INTO agent_sessions_new (id, task_id, agent_type, name, external_session_id, pid, state, started_at, ended_at, exit_code)
            SELECT id, task_id, agent_type, NULL, external_session_id, pid, state, started_at, ended_at, exit_code FROM agent_sessions
          `);

          db.run('DROP TABLE agent_sessions');
          db.run('ALTER TABLE agent_sessions_new RENAME TO agent_sessions');

          db.run('CREATE INDEX IF NOT EXISTS idx_agent_sessions_task_id ON agent_sessions(task_id)');
          db.run('CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions(state)');
        }
      }

      // ── v6 migration: add 'name' column to agent_sessions ──
      if (current < 6) {
        const cols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('agent_sessions')"
        ).all();
        const hasNameCol = cols.some(c => c.name === 'name');
        if (!hasNameCol) {
          db.run('ALTER TABLE agent_sessions ADD COLUMN name TEXT DEFAULT NULL');
        }
      }

      // ── v7 migration: pending_approvals + approval_rules tables ──
      // (Tables are created by schema.sql via CREATE TABLE IF NOT EXISTS — no extra DDL needed here)

      // ── v8 migration: add config_options column to agent_sessions ──
      if (current < 8) {
        const cols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('agent_sessions')"
        ).all();
        const hasCol = cols.some(c => c.name === 'config_options');
        if (!hasCol) {
          db.run('ALTER TABLE agent_sessions ADD COLUMN config_options TEXT DEFAULT NULL');
        }
      }

      // ── v9 migration: mcp_servers table ──
      // (Table created by schema.sql via CREATE TABLE IF NOT EXISTS — no extra DDL needed here)

      // ── v10 migration: add archived column to tasks and agent_sessions ──
      if (current < 10) {
        const taskCols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('tasks')"
        ).all();
        if (!taskCols.some(c => c.name === 'archived')) {
          db.run('ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
        }

        const sessionCols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('agent_sessions')"
        ).all();
        if (!sessionCols.some(c => c.name === 'archived')) {
          db.run('ALTER TABLE agent_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
        }
      }

      // ── v11 migration: add available_commands column to agent_sessions ──
      if (current < 11) {
        const cols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('agent_sessions')"
        ).all();
        if (!cols.some(c => c.name === 'available_commands')) {
          db.run('ALTER TABLE agent_sessions ADD COLUMN available_commands TEXT DEFAULT NULL');
        }
      }

      // ── v12 migration: add usage_json column to agent_sessions ──
      if (current < 12) {
        const sessionCols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('agent_sessions')"
        ).all();
        if (!sessionCols.some(c => c.name === 'usage_json')) {
          db.run('ALTER TABLE agent_sessions ADD COLUMN usage_json TEXT DEFAULT NULL');
        }
      }

      // ── v13 migration: remove CHECK constraints on agent/agent_type to allow new agent types ──
      if (current < 13) {
        // Recreate tasks without agent CHECK constraint
        const taskCols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('tasks')"
        ).all();
        const taskColNames = taskCols.map(c => c.name);
        if (taskColNames.includes('agent')) {
          const archivedCol = taskColNames.includes('archived') ? ', archived' : '';
          const archivedDefault = taskColNames.includes('archived') ? ', archived INTEGER NOT NULL DEFAULT 0' : '';
          db.run(`
            CREATE TABLE tasks_v13 (
              id          TEXT PRIMARY KEY,
              title       TEXT NOT NULL CHECK (length(title) <= 500),
              description TEXT CHECK (description IS NULL OR length(description) <= 10000),
              status      TEXT NOT NULL DEFAULT 'todo'
                            CHECK (status IN ('todo', 'working', 'awaiting_input', 'done')),
              agent       TEXT NOT NULL DEFAULT 'claude-code'${archivedDefault},
              created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
          `);
          db.run(`INSERT INTO tasks_v13 (id, title, description, status, agent${archivedCol}, created_at)
                  SELECT id, title, description, status, agent${archivedCol}, created_at FROM tasks`);
          db.run('DROP TABLE tasks');
          db.run('ALTER TABLE tasks_v13 RENAME TO tasks');
        }

        // Recreate agent_sessions without agent_type CHECK constraint
        // Guard: only run if old schema with task_id column (v17 migrates to meta_json)
        const sessCols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('agent_sessions')"
        ).all();
        const sessColNames = sessCols.map(c => c.name);
        if (sessColNames.includes('task_id')) { db.run(`
          CREATE TABLE agent_sessions_v13 (
            id                  TEXT PRIMARY KEY,
            task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            agent_type          TEXT NOT NULL,
            name                TEXT DEFAULT NULL,
            external_session_id TEXT,
            pid                 INTEGER,
            state               TEXT NOT NULL DEFAULT 'starting'
                                  CHECK (state IN ('starting', 'ready', 'running', 'stopped', 'crashed', 'interrupted')),
            config_options      TEXT DEFAULT NULL,
            available_commands  TEXT DEFAULT NULL,
            started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            archived            INTEGER NOT NULL DEFAULT 0,
            ended_at            TEXT,
            exit_code           INTEGER,
            usage_json          TEXT DEFAULT NULL
          )
        `);
        // Copy all rows — only include columns that exist in the old table
        const copyColsList = ['id','task_id','agent_type','name','external_session_id','pid','state',
          'config_options','available_commands','started_at','archived','ended_at','exit_code','usage_json']
          .filter(c => sessColNames.includes(c));
        const copyCols = copyColsList.join(', ');
        db.run(`INSERT INTO agent_sessions_v13 (${copyCols}) SELECT ${copyCols} FROM agent_sessions`);
        db.run('DROP TABLE agent_sessions');
        db.run('ALTER TABLE agent_sessions_v13 RENAME TO agent_sessions');
        db.run('CREATE INDEX IF NOT EXISTS idx_agent_sessions_task_id ON agent_sessions(task_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions(state)');
        } // end if sessColNames.includes('task_id')
      }

      // ── v14 migration: settings key-value table ──
      // (Table created by schema.sql via CREATE TABLE IF NOT EXISTS — no extra DDL needed here)

      // ── v15 migration: add last_message column to agent_sessions ──
      if (current < 15) {
        const cols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('agent_sessions')"
        ).all();
        if (!cols.some(c => c.name === 'last_message')) {
          db.run('ALTER TABLE agent_sessions ADD COLUMN last_message TEXT DEFAULT NULL');
        }
      }

      // ── v16 migration: composite indexes for session-scoped queries ──
      if (current < 16) {
        db.run('CREATE INDEX IF NOT EXISTS idx_acp_events_session_created ON acp_events(session_id, created_at)');
        db.run('CREATE INDEX IF NOT EXISTS idx_awaiting_input_session_created ON awaiting_input(session_id, created_at)');
        db.run('CREATE INDEX IF NOT EXISTS idx_pending_approvals_session_created ON pending_approvals(session_id, created_at)');
      }

      // ── v17 migration: sessions.meta_json replaces task_id FK; task_id nullable on awaiting_input/approvals ──
      if (current < 17) {
        // 1. Recreate agent_sessions with meta_json instead of task_id
        const sessCols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('agent_sessions')"
        ).all().map(c => c.name);

        if (sessCols.includes('task_id')) {
          db.run(`
            CREATE TABLE agent_sessions_v17 (
              id                  TEXT PRIMARY KEY,
              meta_json           TEXT NOT NULL DEFAULT '{}',
              agent_type          TEXT NOT NULL,
              name                TEXT DEFAULT NULL,
              external_session_id TEXT,
              pid                 INTEGER,
              state               TEXT NOT NULL DEFAULT 'starting'
                                    CHECK (state IN ('starting', 'ready', 'running', 'stopped', 'crashed', 'interrupted')),
              config_options      TEXT DEFAULT NULL,
              available_commands  TEXT DEFAULT NULL,
              started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
              archived            INTEGER NOT NULL DEFAULT 0,
              ended_at            TEXT,
              exit_code           INTEGER,
              usage_json          TEXT DEFAULT NULL,
              last_message        TEXT DEFAULT NULL
            )
          `);
          // Migrate: wrap existing task_id into meta_json
          db.run(`
            INSERT INTO agent_sessions_v17 (id, meta_json, agent_type, name, external_session_id, pid, state,
              config_options, available_commands, started_at, archived, ended_at, exit_code, usage_json, last_message)
            SELECT id,
              json_object('task_id', task_id) as meta_json,
              agent_type, name, external_session_id, pid, state,
              config_options, available_commands, started_at, archived, ended_at, exit_code, usage_json, last_message
            FROM agent_sessions
          `);
          db.run('DROP TABLE agent_sessions');
          db.run('ALTER TABLE agent_sessions_v17 RENAME TO agent_sessions');
          db.run('CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions(state)');
          db.run("CREATE INDEX IF NOT EXISTS idx_agent_sessions_meta_task ON agent_sessions(json_extract(meta_json, '$.task_id'))");
        }

        // 2. Make awaiting_input.task_id nullable (recreate without NOT NULL)
        const inputDef = db.query<{ sql: string }, []>(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='awaiting_input'"
        ).get();
        if (inputDef?.sql?.includes('task_id') && inputDef.sql.includes('NOT NULL') &&
            inputDef.sql.indexOf('NOT NULL') < inputDef.sql.indexOf('session_id')) {
          // More reliable check: look for task_id TEXT NOT NULL pattern
          if (/task_id\s+TEXT\s+NOT\s+NULL/i.test(inputDef.sql)) {
            db.run(`
              CREATE TABLE awaiting_input_v17 (
                id         TEXT PRIMARY KEY,
                task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
                session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
                question   TEXT NOT NULL CHECK (length(question) <= 10000),
                status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered')),
                response   TEXT CHECK (response IS NULL OR length(response) <= 10000),
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
              )
            `);
            db.run(`INSERT INTO awaiting_input_v17 SELECT * FROM awaiting_input`);
            db.run('DROP TABLE awaiting_input');
            db.run('ALTER TABLE awaiting_input_v17 RENAME TO awaiting_input');
            db.run('CREATE INDEX IF NOT EXISTS idx_awaiting_input_task_id ON awaiting_input(task_id)');
            db.run('CREATE INDEX IF NOT EXISTS idx_awaiting_input_session_id ON awaiting_input(session_id)');
            db.run('CREATE INDEX IF NOT EXISTS idx_awaiting_input_session_created ON awaiting_input(session_id, created_at)');
          }
        }

        // 3. Make pending_approvals.task_id nullable
        const approvalDef = db.query<{ sql: string }, []>(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='pending_approvals'"
        ).get();
        if (approvalDef?.sql && /task_id\s+TEXT\s+NOT\s+NULL/i.test(approvalDef.sql)) {
          db.run(`
            CREATE TABLE pending_approvals_v17 (
              id          TEXT PRIMARY KEY,
              task_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
              session_id  TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
              tool_name   TEXT NOT NULL,
              tool_title  TEXT NOT NULL,
              context     TEXT NOT NULL DEFAULT '{}',
              options     TEXT NOT NULL DEFAULT '[]',
              status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
              decision    TEXT CHECK (decision IS NULL OR decision IN ('allow_once', 'allow_always', 'deny')),
              created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
          `);
          db.run(`INSERT INTO pending_approvals_v17 SELECT * FROM pending_approvals`);
          db.run('DROP TABLE pending_approvals');
          db.run('ALTER TABLE pending_approvals_v17 RENAME TO pending_approvals');
          db.run('CREATE INDEX IF NOT EXISTS idx_pending_approvals_task ON pending_approvals(task_id)');
          db.run('CREATE INDEX IF NOT EXISTS idx_pending_approvals_session ON pending_approvals(session_id)');
          db.run('CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON pending_approvals(status)');
          db.run('CREATE INDEX IF NOT EXISTS idx_pending_approvals_session_created ON pending_approvals(session_id, created_at)');
        }
      }

      // ── v18 migration: acp_events.task_id nullable (supports task-less local-dir sessions) ──
      if (current < 18) {
        const evDef = db.query<{ sql: string }, []>(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='acp_events'"
        ).get();
        if (evDef?.sql && /task_id\s+TEXT\s+NOT\s+NULL/i.test(evDef.sql)) {
          db.run(`
            CREATE TABLE acp_events_v18 (
              id         TEXT PRIMARY KEY,
              task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
              session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
              type       TEXT NOT NULL CHECK (type IN ('thought', 'action', 'await_input', 'result', 'prompt')),
              content    TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
          `);
          db.run(`INSERT INTO acp_events_v18 SELECT * FROM acp_events`);
          db.run('DROP TABLE acp_events');
          db.run('ALTER TABLE acp_events_v18 RENAME TO acp_events');
          db.run('CREATE INDEX IF NOT EXISTS idx_acp_events_task_id ON acp_events(task_id)');
          db.run('CREATE INDEX IF NOT EXISTS idx_acp_events_session_id ON acp_events(session_id)');
          db.run('CREATE INDEX IF NOT EXISTS idx_acp_events_session_created ON acp_events(session_id, created_at)');
        }
      }

      // ── v19 migration: workspace_json column on tasks ──────────────────────
      if (current < 19) {
        const taskCols = db.query<{ name: string }, []>(
          "SELECT name FROM pragma_table_info('tasks')"
        ).all();
        if (!taskCols.some(c => c.name === 'workspace_json')) {
          db.run('ALTER TABLE tasks ADD COLUMN workspace_json TEXT DEFAULT NULL');
        }
        // Backfill existing tasks that have repos attached
        db.run(`
          UPDATE tasks
          SET workspace_json = json_object(
            'provider', 'git-worktree',
            'config', json_object(
              'repos', (
                SELECT json_group_array(r.url)
                FROM task_repos tr
                JOIN repos r ON r.id = tr.repo_id
                WHERE tr.task_id = tasks.id
              )
            )
          )
          WHERE workspace_json IS NULL
            AND EXISTS (SELECT 1 FROM task_repos WHERE task_id = tasks.id)
        `);
      }

      db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION]);
    })();
    console.log(`[db] migrated to schema version ${SCHEMA_VERSION}`);
  }
}
