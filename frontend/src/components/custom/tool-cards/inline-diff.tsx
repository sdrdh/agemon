/**
 * Lightweight unified diff view for Edit tool oldString → newString.
 * Shows line numbers, +/- markers, and color-coded backgrounds.
 * No external diff library — uses simple line-by-line comparison.
 */

interface DiffLine {
  type: 'context' | 'removed' | 'added';
  /** Line number in the old text (null for added lines) */
  oldNum: number | null;
  /** Line number in the new text (null for removed lines) */
  newNum: number | null;
  content: string;
}

/**
 * Compute a simple line diff between old and new text.
 * Uses a greedy LCS-style approach for small inputs.
 * Falls back to full remove/add for large diffs.
 */
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // For very large inputs, skip LCS and just show full remove/add
  if (oldLines.length + newLines.length > 200) {
    return simpleDiff(oldLines, newLines);
  }

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'context', oldNum: i, newNum: j, content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', oldNum: null, newNum: j, content: newLines[j - 1] });
      j--;
    } else {
      stack.push({ type: 'removed', oldNum: i, newNum: null, content: oldLines[i - 1] });
      i--;
    }
  }

  // Reverse since we built it backwards
  for (let k = stack.length - 1; k >= 0; k--) {
    result.push(stack[k]);
  }

  return result;
}

function simpleDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  for (let i = 0; i < oldLines.length; i++) {
    result.push({ type: 'removed', oldNum: i + 1, newNum: null, content: oldLines[i] });
  }
  for (let j = 0; j < newLines.length; j++) {
    result.push({ type: 'added', oldNum: null, newNum: j + 1, content: newLines[j] });
  }
  return result;
}

const LINE_STYLES = {
  context: '',
  removed: 'bg-red-500/10',
  added: 'bg-emerald-500/10',
} as const;

const MARKER_STYLES = {
  context: 'text-muted-foreground/40',
  removed: 'text-red-400',
  added: 'text-emerald-400',
} as const;

const MARKER_CHAR = {
  context: ' ',
  removed: '-',
  added: '+',
} as const;

export function InlineDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = computeDiff(oldText, newText);
  const maxOldNum = Math.max(...lines.map((l) => l.oldNum ?? 0), 0);
  const maxNewNum = Math.max(...lines.map((l) => l.newNum ?? 0), 0);
  const gutterWidth = Math.max(String(maxOldNum).length, String(maxNewNum).length);

  return (
    <div className="rounded border border-muted overflow-auto max-h-[240px] text-xs font-mono">
      {lines.map((line, idx) => (
        <div key={idx} className={`flex ${LINE_STYLES[line.type]} min-w-fit`}>
          {/* Old line number */}
          <span className="select-none text-muted-foreground/30 text-right px-1.5 shrink-0 border-r border-muted/50" style={{ minWidth: `${gutterWidth + 1.5}ch` }}>
            {line.oldNum ?? ''}
          </span>
          {/* New line number */}
          <span className="select-none text-muted-foreground/30 text-right px-1.5 shrink-0 border-r border-muted/50" style={{ minWidth: `${gutterWidth + 1.5}ch` }}>
            {line.newNum ?? ''}
          </span>
          {/* +/- marker */}
          <span className={`select-none px-1 shrink-0 ${MARKER_STYLES[line.type]}`}>
            {MARKER_CHAR[line.type]}
          </span>
          {/* Content */}
          <span className="whitespace-pre pr-2">{line.content || '\u00A0'}</span>
        </div>
      ))}
    </div>
  );
}
