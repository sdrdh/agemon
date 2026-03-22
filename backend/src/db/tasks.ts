// Tasks are now backed by per-task JSON files + in-memory SQLite projection.
// All functions delegate to task-store.ts; callers are unchanged.
export {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  listTasksByProject,
} from '../lib/task-store.ts';
