-- Agemon Database Schema
-- Version: 3
-- Note: schema_version table is created by client.ts before this file runs.

-- Core task metadata
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(title) <= 500),
  description TEXT CHECK (description IS NULL OR length(description) <= 10000),
  status      TEXT NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo', 'working', 'awaiting_input', 'done')),
  repos       TEXT NOT NULL DEFAULT '[]',  -- JSON array of repo URLs
  agent       TEXT NOT NULL DEFAULT 'claude-code'
                CHECK (agent IN ('claude-code', 'opencode', 'aider', 'gemini')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Agent session lifecycle (one task → many sessions)
CREATE TABLE IF NOT EXISTS agent_sessions (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_type          TEXT NOT NULL
                        CHECK (agent_type IN ('claude-code', 'opencode', 'aider', 'gemini')),
  external_session_id TEXT,          -- Provider session ID for --resume (set after first output)
  pid                 INTEGER,       -- OS process ID; NULL if not running
  state               TEXT NOT NULL DEFAULT 'starting'
                        CHECK (state IN ('starting', 'running', 'stopped', 'crashed', 'interrupted')),
  started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ended_at            TEXT,          -- NULL while running
  exit_code           INTEGER        -- NULL while running; 0=clean exit; non-zero=error
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_task_id ON agent_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions(state);

-- Agent thought/action event stream
CREATE TABLE IF NOT EXISTS acp_events (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('thought', 'action', 'await_input', 'result')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_acp_events_task_id ON acp_events(task_id);
CREATE INDEX IF NOT EXISTS idx_acp_events_session_id ON acp_events(session_id);

-- Blocking questions from the agent
CREATE TABLE IF NOT EXISTS awaiting_input (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  question   TEXT NOT NULL CHECK (length(question) <= 10000),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered')),
  response   TEXT CHECK (response IS NULL OR length(response) <= 10000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_awaiting_input_task_id ON awaiting_input(task_id);
CREATE INDEX IF NOT EXISTS idx_awaiting_input_session_id ON awaiting_input(session_id);

-- Pending code reviews / diffs
CREATE TABLE IF NOT EXISTS diffs (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_diffs_task_id ON diffs(task_id);

-- Repository registry
CREATE TABLE IF NOT EXISTS repos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Many-to-many: tasks <-> repos
CREATE TABLE IF NOT EXISTS task_repos (
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repo_id  INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_task_repos_repo ON task_repos(repo_id);
