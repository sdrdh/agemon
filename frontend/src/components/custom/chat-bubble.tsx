import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { ApprovalCard } from '@/components/custom/approval-card';
import type { ChatMessage, PendingApproval, ApprovalDecision } from '@agemon/shared';

const rehypePlugins = [rehypeHighlight];
const remarkPlugins = [remarkGfm];

export function ChatBubble({ message, approvalLookup, onApprovalDecision }: {
  message: ChatMessage;
  approvalLookup?: Map<string, PendingApproval>;
  onApprovalDecision?: (approvalId: string, decision: ApprovalDecision) => void;
}) {
  const { role, content, eventType } = message;

  if (eventType === 'approval_request') {
    // Content format: "approvalId:status:toolName" (toolName may contain colons)
    const firstColon = content.indexOf(':');
    const secondColon = firstColon >= 0 ? content.indexOf(':', firstColon + 1) : -1;
    const approvalId = firstColon >= 0 ? content.slice(0, firstColon) : content;
    const status = secondColon >= 0 ? content.slice(firstColon + 1, secondColon) : undefined;
    const toolName = secondColon >= 0 ? content.slice(secondColon + 1) : undefined;
    if (approvalLookup && onApprovalDecision) {
      const approval = approvalLookup.get(approvalId);
      if (approval) {
        return <ApprovalCard approval={approval} onDecision={onApprovalDecision} />;
      }
    }
    // Approval not in store — render compact fallback from embedded data
    const label = toolName ? `${toolName} — ${status === 'pending' ? 'awaiting approval' : status}` : 'Tool approval';
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-muted-foreground italic px-3 py-1">{label}</span>
      </div>
    );
  }

  if (role === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-muted-foreground italic px-3 py-1">{content}</span>
      </div>
    );
  }

  if (role === 'user') {
    return (
      <div className="flex justify-end my-2">
        <div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }

  if (eventType === 'input_request') {
    return (
      <div className="flex justify-start my-2">
        <div className="max-w-[85%] rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm break-words prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-headings:my-2 max-w-none">
          <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{content}</Markdown>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start my-2">
      <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm break-words prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-headings:my-2 max-w-none">
        <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{content}</Markdown>
      </div>
    </div>
  );
}
