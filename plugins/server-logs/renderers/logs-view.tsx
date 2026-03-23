import { useState, useEffect, useRef, useCallback } from 'react';
import { ScrollText, Pause, Play, Trash2, Search, ArrowDown, Loader2 } from 'lucide-react';

// Max lines to keep in memory
const MAX_LINES = 5000;
const INITIAL_LINES = 300;

interface ParsedLine {
  id: number;
  raw: string;
  timestamp: string;
  message: string;
  level: 'error' | 'warn' | 'info' | 'debug';
}

let lineCounter = 0;

function parseLine(raw: string): ParsedLine {
  // Format: "Mar 23 19:06:54 agemon agemon-start.sh[12345]: message"
  const match = raw.match(/^(\S+\s+\d+\s+[\d:]+)\s+\S+\s+\S+:\s+(.*)/);
  const timestamp = match?.[1] ?? '';
  const message = match?.[2] ?? raw;

  let level: ParsedLine['level'] = 'info';
  const lower = message.toLowerCase();
  if (lower.includes('error') || lower.includes('panic') || lower.includes('fatal')) level = 'error';
  else if (lower.includes('warn')) level = 'warn';
  else if (lower.includes('debug') || lower.includes('trace')) level = 'debug';

  return { id: lineCounter++, raw, timestamp, message, level };
}

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-yellow-400',
  info: 'text-foreground/80',
  debug: 'text-foreground/40',
};

function LogLine({ line, highlight }: { line: ParsedLine; highlight?: string }) {
  const color = LEVEL_COLORS[line.level] ?? 'text-foreground/80';

  let msgContent: React.ReactNode = line.message;
  if (highlight) {
    const parts = line.message.split(new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    msgContent = parts.map((part, i) =>
      part.toLowerCase() === highlight.toLowerCase()
        ? <mark key={i} className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{part}</mark>
        : part
    );
  }

  return (
    <div className={`flex gap-3 py-0.5 px-3 font-mono text-xs leading-5 hover:bg-muted/30 ${color}`}>
      <span className="text-muted-foreground/50 shrink-0 select-none w-[140px]">{line.timestamp}</span>
      <span className="whitespace-pre-wrap break-all">{msgContent}</span>
    </div>
  );
}

export default function LogsView() {
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const bufferRef = useRef<ParsedLine[]>([]);

  pausedRef.current = paused;

  // Load history
  useEffect(() => {
    fetch(`/api/plugins/server-logs/history?lines=${INITIAL_LINES}`, { credentials: 'include' })
      .then(res => res.text())
      .then(text => {
        const parsed = text.split('\n').filter(Boolean).map(parseLine);
        setLines(parsed);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // SSE stream
  useEffect(() => {
    const es = new EventSource('/api/plugins/server-logs/stream');

    es.onmessage = (event) => {
      const raw = JSON.parse(event.data) as string;
      const parsed = parseLine(raw);

      if (pausedRef.current) {
        bufferRef.current.push(parsed);
        return;
      }

      setLines(prev => {
        const next = [...prev, parsed];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    };

    return () => es.close();
  }, []);

  // Flush buffer on unpause
  useEffect(() => {
    if (!paused && bufferRef.current.length > 0) {
      const buffered = bufferRef.current;
      bufferRef.current = [];
      setLines(prev => {
        const next = [...prev, ...buffered];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    }
  }, [paused]);

  // Auto-scroll
  useEffect(() => {
    if (atBottom && !paused && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, atBottom, paused]);

  // Detect scroll position
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAtBottom(isAtBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setAtBottom(true);
    }
  }, []);

  const filtered = filter
    ? lines.filter(l => l.raw.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        <ScrollText className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Server Logs</span>
        <span className="text-xs text-muted-foreground ml-1">
          {filtered.length}{filter ? ` / ${lines.length}` : ''} lines
          {paused && <span className="text-yellow-500 ml-1">(paused)</span>}
        </span>

        <div className="flex-1" />

        {showSearch && (
          <input
            autoFocus
            type="text"
            placeholder="Filter logs..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setShowSearch(false); setFilter(''); } }}
            className="h-7 w-56 px-2 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}

        <button
          onClick={() => { setShowSearch(!showSearch); if (showSearch) setFilter(''); }}
          className={`p-1.5 rounded hover:bg-muted ${showSearch ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
          title="Search (Ctrl+F)"
        >
          <Search className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setPaused(!paused)}
          className={`p-1.5 rounded hover:bg-muted ${paused ? 'text-yellow-500' : 'text-muted-foreground'}`}
          title={paused ? 'Resume' : 'Pause'}
        >
          {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={() => setLines([])}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground"
          title="Clear"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Log output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading logs...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            {filter ? 'No matching lines' : 'No log lines yet'}
          </div>
        ) : (
          filtered.map(line => (
            <LogLine key={line.id} line={line} highlight={filter || undefined} />
          ))
        )}
      </div>

      {/* Scroll-to-bottom FAB */}
      {!atBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 p-2 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
