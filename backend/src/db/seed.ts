import { randomUUID } from 'crypto';
import { runMigrations, db } from './client.ts';

if (process.env.NODE_ENV === 'production') {
  console.error('[seed] refusing to run seed in production');
  process.exit(1);
}

runMigrations();

const taskId1 = randomUUID();
const taskId2 = randomUUID();
const taskId3 = randomUUID();

// Sample tasks
db.createTask({
  id: taskId1,
  title: 'Add JWT authentication to backend + frontend',
  description: 'Implement JWT-based auth across the API and React app. Use Passport.js on the backend.',
  status: 'todo',
  repos: ['https://github.com/example/backend', 'https://github.com/example/frontend'],
  agent: 'claude-code',
});

db.createTask({
  id: taskId2,
  title: 'Refactor database query layer',
  description: 'Extract raw SQL into typed query functions. Add indexes for performance.',
  status: 'working',
  repos: ['https://github.com/example/backend'],
  agent: 'claude-code',
});

db.createTask({
  id: taskId3,
  title: 'Write mobile layout tests',
  description: 'Add Playwright tests for mobile viewport on key user flows.',
  status: 'done',
  repos: ['https://github.com/example/frontend'],
  agent: 'aider',
});

// Agent session for the working task
const sessionId2 = randomUUID();
db.insertSession({
  id: sessionId2,
  task_id: taskId2,
  agent_type: 'claude-code',
  pid: null,
});
db.updateSessionState(sessionId2, 'running');

// Sample ACP events for the working task (must reference a session)
db.insertEvent({ id: randomUUID(), task_id: taskId2, session_id: sessionId2, type: 'thought', content: 'Looking at the existing query patterns in the codebase...' });
db.insertEvent({ id: randomUUID(), task_id: taskId2, session_id: sessionId2, type: 'action', content: 'Reading backend/src/db/client.ts' });
db.insertEvent({ id: randomUUID(), task_id: taskId2, session_id: sessionId2, type: 'thought', content: 'I see several repeated patterns. I will extract them into typed helpers.' });

// Completed session for the done task
const sessionId3 = randomUUID();
db.insertSession({
  id: sessionId3,
  task_id: taskId3,
  agent_type: 'aider',
  pid: null,
});
db.updateSessionState(sessionId3, 'stopped', { exit_code: 0 });

console.log('[seed] sample data inserted');
