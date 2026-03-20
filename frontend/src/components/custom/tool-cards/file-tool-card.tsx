import type { ToolCardContentProps } from './tool-card-shell';
import { InlineDiff } from './inline-diff';

export function FileToolCard({ toolCall }: ToolCardContentProps) {
  const filePath = toolCall.args.filePath;
  const hasEdit = toolCall.args.oldString || toolCall.args.newString;

  return (
    <div className="space-y-2">
      {filePath && (
        <div className="text-xs font-mono text-muted-foreground truncate">{filePath}</div>
      )}
      {hasEdit && (
        <InlineDiff
          oldText={toolCall.args.oldString ?? ''}
          newText={toolCall.args.newString ?? ''}
        />
      )}
      {toolCall.display?.file?.content && (
        <pre className="text-xs font-mono text-muted-foreground bg-muted/30 px-2 py-1.5 rounded overflow-auto max-h-[200px] whitespace-pre-wrap break-all">
          {toolCall.display.file.content}
        </pre>
      )}
      {toolCall.error && (
        <div className="text-xs bg-destructive/10 text-destructive px-2 py-1.5 rounded whitespace-pre-wrap break-all">
          {toolCall.error}
        </div>
      )}
      {toolCall.output && !toolCall.display?.file?.content && !hasEdit && (
        <pre className="text-xs font-mono text-muted-foreground bg-muted/30 px-2 py-1.5 rounded overflow-auto max-h-[200px] whitespace-pre-wrap break-all">
          {toolCall.output}
        </pre>
      )}
    </div>
  );
}
