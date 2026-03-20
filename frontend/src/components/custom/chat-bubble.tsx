import { memo, useState, useCallback, useEffect, Component, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check } from 'lucide-react';
import { ApprovalCard } from '@/components/custom/approval-card';
import { showToast } from '@/lib/toast';
import type { ChatMessage, PendingApproval, ApprovalDecision, CustomRendererManifest } from '@agemon/shared';

const rehypePlugins = [rehypeHighlight];
const remarkPlugins = [remarkGfm];

// ─── Custom Renderer Registry (fetched once, cached) ─────────────────────────

let registryPromise: Promise<Map<string, CustomRendererManifest>> | null = null;
const componentCache = new Map<string, React.ComponentType<{ message: unknown }>>();

/** Reset the renderer cache — call when new plugins are hot-loaded. */
export function invalidateRendererCache(): void {
  registryPromise = null;
  componentCache.clear();
}

function getRegistry(): Promise<Map<string, CustomRendererManifest>> {
  if (!registryPromise) {
    registryPromise = fetch('/api/renderers/registry', { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('Failed');
        return res.json() as Promise<{ renderers: CustomRendererManifest[] }>;
      })
      .then(data => {
        const map = new Map<string, CustomRendererManifest>();
        for (const r of data.renderers) map.set(r.messageType, r);
        return map;
      })
      .catch(() => new Map<string, CustomRendererManifest>());
  }
  return registryPromise;
}

// ─── Error Boundary for custom renderers ─────────────────────────────────────

class RendererErrorBoundary extends Component<
  { children: ReactNode; messageType: string },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; messageType: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex justify-start my-2 max-w-[85%]">
          <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground italic">
            Renderer error ({this.props.messageType})
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

async function loadRenderer(messageType: string): Promise<React.ComponentType<{ message: unknown }> | null> {
  if (componentCache.has(messageType)) return componentCache.get(messageType)!;

  const registry = await getRegistry();
  const manifest = registry.get(messageType);
  if (!manifest) return null;

  try {
    const mod = await import(/* @vite-ignore */ `/api/renderers/${manifest.name}.js`);
    const Component = mod.default as React.ComponentType<{ message: unknown }>;
    componentCache.set(messageType, Component);
    return Component;
  } catch (err) {
    console.error(`Failed to load renderer ${manifest.name}:`, err);
    return null;
  }
}

// ─── Components ──────────────────────────────────────────────────────────────

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
        <Check className="h-4 w-4 text-success" />
      ) : (
        <Copy className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}

// Built-in event types that should never go through custom rendering
const BUILTIN_EVENT_TYPES = new Set([
  'thought', 'action', 'result', 'input_request', 'approval_request',
  'status', 'error', 'terminal_output',
]);

function DefaultBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start my-2 max-w-[85%]">
      <div className="group relative min-w-0 rounded-lg bg-muted px-3 py-2 text-sm break-words overflow-hidden prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-headings:my-2 max-w-none">
        <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{content}</Markdown>
        <CopyButton text={content} />
      </div>
    </div>
  );
}

/**
 * Attempts to render via a custom plugin renderer for non-builtin event types.
 * Falls back to default markdown bubble if no renderer is registered.
 */
function MaybeCustomBubble({ message }: { message: ChatMessage }) {
  const [Component, setComponent] = useState<React.ComponentType<{ message: unknown }> | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadRenderer(message.eventType).then((c) => {
      if (cancelled) return;
      setComponent(() => c);
      setChecked(true);
    });
    return () => { cancelled = true; };
  }, [message.eventType]);

  if (!checked) {
    // Still checking registry — show default rendering while waiting
    return <DefaultBubble content={message.content} />;
  }

  if (Component) {
    return (
      <RendererErrorBoundary messageType={message.eventType}>
        <div className="flex justify-start my-2 max-w-[85%]">
          <Component message={message} />
        </div>
      </RendererErrorBoundary>
    );
  }

  return <DefaultBubble content={message.content} />;
}

export const ChatBubble = memo(function ChatBubble({ message, approvalLookup, onApprovalDecision, connected }: {
  message: ChatMessage;
  approvalLookup?: Map<string, PendingApproval>;
  onApprovalDecision?: (approvalId: string, decision: ApprovalDecision) => void;
  connected?: boolean;
}) {
  const { role, content, eventType } = message;

  if (eventType === 'approval_request') {
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
      <div className="flex justify-start my-2 max-w-[85%]">
        <div className="group relative min-w-0 rounded-lg border border-warning bg-warning/10 px-3 py-2 text-sm break-words overflow-hidden prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-headings:my-2 max-w-none">
          <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{content}</Markdown>
          <CopyButton text={content} />
        </div>
      </div>
    );
  }

  // Non-builtin event types may have a custom renderer from a plugin
  if (!BUILTIN_EVENT_TYPES.has(eventType)) {
    return <MaybeCustomBubble message={message} />;
  }

  return <DefaultBubble content={content} />;
});
