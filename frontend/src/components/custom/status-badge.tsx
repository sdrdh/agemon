import type { TaskStatus } from '@agemon/shared';
import { Badge } from '@/components/ui/badge';

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  working: 'Working',
  awaiting_input: 'Awaiting Input',
  done: 'Done',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={status}>{STATUS_LABELS[status]}</Badge>;
}
