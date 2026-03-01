import { randomUUID } from 'crypto';
import { runMigrations, db } from './client.ts';

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

// Sample ACP events for the working task
db.insertEvent({ id: randomUUID(), task_id: taskId2, type: 'thought', content: 'Looking at the existing query patterns in the codebase...' });
db.insertEvent({ id: randomUUID(), task_id: taskId2, type: 'action', content: 'Reading backend/src/db/client.ts' });
db.insertEvent({ id: randomUUID(), task_id: taskId2, type: 'thought', content: 'I see several repeated patterns. I will extract them into typed helpers.' });

console.log('[seed] sample data inserted');
