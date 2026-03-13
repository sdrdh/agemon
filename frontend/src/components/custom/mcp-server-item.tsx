import { Plus, X, Globe, Terminal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { McpServerEntry } from '@agemon/shared';

export function McpServerItem({
  entry,
  onDelete,
  readOnly,
}: {
  entry: McpServerEntry;
  onDelete?: () => void;
  readOnly?: boolean;
}) {
  const config = entry.config;
  const isHttp = 'type' in config && config.type === 'http';
  const detail = isHttp
    ? config.url
    : ('command' in config ? config.command + (config.args?.length ? ' ' + config.args.join(' ') : '') : '');

  return (
    <div className="flex items-center gap-2 py-2 px-3 rounded-md border bg-background group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{entry.name}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
            {isHttp ? (
              <><Globe className="h-2.5 w-2.5 mr-0.5" />http</>
            ) : (
              <><Terminal className="h-2.5 w-2.5 mr-0.5" />stdio</>
            )}
          </Badge>
          {entry.scope === 'global' && readOnly && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">global</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5 font-mono">{detail}</p>
        {isHttp && config.headers && config.headers.length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {config.headers.length} header{config.headers.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>
      {!readOnly && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
          aria-label={`Remove ${entry.name}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
