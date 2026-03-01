-- Agemon Database Schema
-- Version: 1
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
                CHECK (agent IN ('claude-code', 'aider', 'gemini')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Agent thought/action event stream
CREATE TABLE IF NOT EXISTS acp_events (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('thought', 'action', 'await_input', 'result')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_acp_events_task_id ON acp_events(task_id);

-- Blocking questions from the agent
CREATE TABLE IF NOT EXISTS awaiting_input (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  question   TEXT NOT NULL CHECK (length(question) <= 10000),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered')),
  response   TEXT CHECK (response IS NULL OR length(response) <= 10000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_awaiting_input_task_id ON awaiting_input(task_id);

-- Pending code reviews / diffs
CREATE TABLE IF NOT EXISTS diffs (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_diffs_task_id ON diffs(task_id);

-- PTY terminal sessions
CREATE TABLE IF NOT EXISTS terminal_sessions (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  shell      TEXT NOT NULL DEFAULT '/bin/bash',
  pid        INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_terminal_sessions_task_id ON terminal_sessions(task_id);
