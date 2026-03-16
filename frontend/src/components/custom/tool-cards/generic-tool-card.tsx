import type { ToolCardContentProps } from './tool-card-shell';

export function GenericToolCard({ toolCall }: ToolCardContentProps) {
  const args = toolCall.args;
  const entries = Object.entries(args).filter(([, v]) => v);

  return (
    <div className="space-y-2">
      {entries.length > 0 && (
        <div className="space-y-0.5">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2 text-xs">
              <span className="font-mono text-muted-foreground/60 shrink-0">{key}:</span>
              <span className="font-mono text-muted-foreground break-all">
                {value.length > 200 ? value.slice(0, 199) + '\u2026' : value}
              </span>
            </div>
          ))}
        </div>
      )}
      {toolCall.error && (
        <div className="text-xs bg-destructive/10 text-destructive px-2 py-1.5 rounded whitespace-pre-wrap break-all">
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
