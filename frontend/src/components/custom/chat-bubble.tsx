import { useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check } from 'lucide-react';
import { ApprovalCard } from '@/components/custom/approval-card';
import { showToast } from '@/lib/toast';
import type { ChatMessage, PendingApproval, ApprovalDecision } from '@agemon/shared';

const rehypePlugins = [rehypeHighlight];
const remarkPlugins = [remarkGfm];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      showToast({ title: 'Copied to clipboard' });
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-1 right-1 p-2 rounded opacity-40 group-hover:opacity-100 transition-opacity hover:bg-black/5 dark:hover:bg-white/10"
      aria-label="Copy message"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-500" />
      ) : (
        <Copy className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}

export function ChatBubble({ message, approvalLookup, onApprovalDecision, connected }: {
  message: ChatMessage;
  approvalLookup?: Map<string, PendingApproval>;
  onApprovalDecision?: (approvalId: string, decision: ApprovalDecision) => void;
  connected?: boolean;
}) {
  const { role, content, eventType } = message;

  if (eventType === 'approval_request') {
    // Content format: "approvalId:status:toolName" (toolName may contain colons)
    const firstColon = content.indexOf(':');
    const secondColon = firstColon >= 0 ? content.indexOf(':', firstColon + 1) : -1;
    const approvalId = firstColon >= 0 ? content.slice(0, firstColon) : content;
    const toolName = secondColon >= 0 ? content.slice(secondColon + 1) : undefined;
    if (approvalLookup && onApprovalDecision) {
      const approval = approvalLookup.get(approvalId);
      if (approval) {
        return <ApprovalCard approval={approval} onDecision={onApprovalDecision} connected={connected ?? true} />;
      }
    }
    // Approval not yet in store — brief flash while HTTP fetch loads it
    const fallbackLabel = `${toolName ?? 'Tool approval'} — loading…`;
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-muted-foreground italic px-3 py-1">{fallbackLabel}</span>
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
        <div className="group relative max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {content}
          <CopyButton text={content} />
        </div>
      </div>
    );
  }

  if (eventType === 'input_request') {
    return (
      <div className="flex justify-start my-2">
        <div className="group relative max-w-[85%] rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm break-words prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-headings:my-2 max-w-none">
          <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{content}</Markdown>
          <CopyButton text={content} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start my-2">
      <div className="group relative max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm break-words prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-headings:my-2 max-w-none">
        <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{content}</Markdown>
        <CopyButton text={content} />
      </div>
    </div>
  );
}
