import type { LucideIcon } from 'lucide-react';
import {
  Terminal,
  FileText,
  PenLine,
  FilePlus,
  Search,
  FolderSearch,
  Globe,
  Download,
  Bot,
  Zap,
  Wrench,
} from 'lucide-react';
import type { ToolCallStatus } from '@agemon/shared';

const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  Bash: Terminal,
  bash: Terminal,
  Read: FileText,
  Edit: PenLine,
  Write: FilePlus,
  Grep: Search,
  Glob: FolderSearch,
  WebSearch: Globe,
  web_search: Globe,
  WebFetch: Download,
  Agent: Bot,
  Skill: Zap,
};

const STATUS_COLOR: Record<ToolCallStatus, string> = {
  completed: 'text-emerald-500',
  failed: 'text-red-500',
  pending: 'text-muted-foreground animate-pulse',
  in_progress: 'text-muted-foreground animate-pulse',
};

export function ToolStatusIcon({
  kind,
  status,
  className = 'h-3.5 w-3.5',
}: {
  kind: string;
  status: ToolCallStatus;
  className?: string;
}) {
  const Icon = TOOL_ICON_MAP[kind] ?? Wrench;
  return <Icon className={`${className} shrink-0 ${STATUS_COLOR[status]}`} />;
}
