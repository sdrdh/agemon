import type { ToolCardContentProps } from './tool-card-shell';

export function SearchToolCard({ toolCall }: ToolCardContentProps) {
  const pattern = toolCall.args.pattern;
  const path = toolCall.args.path;

  return (
    <div className="space-y-2">
      {pattern && (
        <code className="block text-xs font-mono bg-muted/50 px-2 py-1.5 rounded">
          /{pattern}/{path ? ` in ${path}` : ''}
        </code>
      )}
      {toolCall.error && (
        <div className="text-xs bg-red-500/10 text-red-400 px-2 py-1.5 rounded whitespace-pre-wrap break-all">
          {toolCall.error}
        </div>
      )}
      {toolCall.output && (
        <pre className="text-xs font-mono text-muted-foreground bg-muted/30 px-2 py-1.5 rounded overflow-auto max-h-[200px] whitespace-pre-wrap break-all">
          {toolCall.output}
        </pre>
      )}
    </div>
  );
}
