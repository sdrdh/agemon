/**
 * @deprecated No longer used in the main app. Task detail UI has moved
 * to the tasks extension. Kept for reference only.
 */
import { useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { X, GitFork, Clock, Bot, Loader2, Plug, Archive, ArchiveRestore } from 'lucide-react';
import { AgentIcon, AGENT_COLORS, agentDisplayName } from '@/components/custom/agent-icons';
import { McpServerList } from '@/components/custom/mcp-server-list';
import type { Task } from '@agemon/shared';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

export function TaskInfoDrawer({
  task,
  sessionCount,
  open,
  onClose,
  onArchive,
}: {
  task: Task;
  sessionCount: number;
  open: boolean;
  onClose: () => void;
  onArchive?: (archived: boolean) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const created = new Date(task.created_at);
  const formattedDate = created.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={`fixed top-0 right-0 z-50 h-full w-[85vw] max-w-sm bg-background border-l shadow-xl transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label="Task details"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-foreground">Task Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent/50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto h-[calc(100%-49px)] px-4 py-4 space-y-5">
          {task.description && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Description</h3>
              <div className="text-sm text-foreground leading-relaxed prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-headings:my-2 max-w-none">
                <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{task.description}</Markdown>
              </div>
            </section>
          )}

          {task.repos.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Repositories</h3>
              <div className="space-y-1.5">
                {task.repos.map((repo) => (
                  <div key={repo.id} className="flex items-center gap-2 text-sm">
                    <GitFork className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-mono text-xs truncate">{repo.name}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Info</h3>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-sm">
                <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Agent</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <AgentIcon agentType={task.agent} className={`h-3.5 w-3.5 ${AGENT_COLORS[task.agent] ?? ''}`} />
                  <span className="text-xs">{agentDisplayName(task.agent)}</span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Created</span>
                <span className="ml-auto text-xs">{formattedDate}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Sessions</span>
                <span className="ml-auto text-xs">{sessionCount}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="h-3.5 w-3.5 shrink-0" />
                <span className="text-muted-foreground">Task ID</span>
                <span className="ml-auto font-mono text-xs truncate max-w-[140px]">{task.id}</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Plug className="h-3 w-3" />
              MCP Servers
            </h3>
            <McpServerList scope="task" taskId={task.id} />
          </section>

          {onArchive && (
            <section className="pt-2 border-t">
              <button
                type="button"
                onClick={() => onArchive(!task.archived)}
                className="flex items-center gap-2 w-full min-h-[44px] px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                {task.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                {task.archived ? 'Unarchive task' : 'Archive task'}
              </button>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
