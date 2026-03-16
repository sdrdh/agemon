-- Agemon Database Schema
-- Version: 10
-- Note: schema_version table is created by client.ts before this file runs.

-- Core task metadata
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(title) <= 500),
  description TEXT CHECK (description IS NULL OR length(description) <= 10000),
  status      TEXT NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo', 'working', 'awaiting_input', 'done')),
  agent       TEXT NOT NULL DEFAULT 'claude-code',
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Agent session lifecycle (one task → many sessions)
CREATE TABLE IF NOT EXISTS agent_sessions (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_type          TEXT NOT NULL,
  name                TEXT DEFAULT NULL,  -- Human-readable label derived from first prompt
  external_session_id TEXT,          -- Provider session ID for --resume (set after first output)
  pid                 INTEGER,       -- OS process ID; NULL if not running
  state               TEXT NOT NULL DEFAULT 'starting'
                        CHECK (state IN ('starting', 'ready', 'running', 'stopped', 'crashed', 'interrupted')),
  config_options      TEXT DEFAULT NULL,  -- JSON: SessionConfigOption[]
  available_commands  TEXT DEFAULT NULL,  -- JSON: AgentCommand[]
  started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  archived            INTEGER NOT NULL DEFAULT 0,
  ended_at            TEXT,          -- NULL while running
  exit_code           INTEGER,       -- NULL while running; 0=clean exit; non-zero=error
  usage_json          TEXT DEFAULT NULL,  -- JSON: SessionUsage latest snapshot
  last_message        TEXT DEFAULT NULL  -- Short preview of last user/agent message
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_task_id ON agent_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions(state);

-- Agent thought/action event stream
CREATE TABLE IF NOT EXISTS acp_events (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('thought', 'action', 'await_input', 'result', 'prompt')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_acp_events_task_id ON acp_events(task_id);
CREATE INDEX IF NOT EXISTS idx_acp_events_session_id ON acp_events(session_id);
CREATE INDEX IF NOT EXISTS idx_acp_events_session_created ON acp_events(session_id, created_at);

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
CREATE INDEX IF NOT EXISTS idx_awaiting_input_session_created ON awaiting_input(session_id, created_at);

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

-- Pending tool call approvals
CREATE TABLE IF NOT EXISTS pending_approvals (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  tool_name   TEXT NOT NULL,
  tool_title  TEXT NOT NULL,
  context     TEXT NOT NULL DEFAULT '{}',
  options     TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  decision    TEXT CHECK (decision IS NULL OR decision IN ('allow_once', 'allow_always', 'deny')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_pending_approvals_task ON pending_approvals(task_id);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_session ON pending_approvals(session_id);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON pending_approvals(status);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_session_created ON pending_approvals(session_id, created_at);

-- Persistent "Always Allow" rules
CREATE TABLE IF NOT EXISTS approval_rules (
  id          TEXT PRIMARY KEY,
  task_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  session_id  TEXT REFERENCES agent_sessions(id) ON DELETE CASCADE,
  tool_name   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_approval_rules_tool ON approval_rules(tool_name);

-- MCP server configurations (global + task-scoped)
CREATE TABLE IF NOT EXISTS mcp_servers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(name) <= 200),
  task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,  -- NULL = global
  config     TEXT NOT NULL,  -- JSON: McpServerConfig (stdio or http)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(name, task_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_task ON mcp_servers(task_id);
-- SQLite treats NULLs as distinct in UNIQUE constraints, so add a partial unique index for global servers
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_global_name ON mcp_servers(name) WHERE task_id IS NULL;

-- Key-value settings store
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
