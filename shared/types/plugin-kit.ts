/**
 * Host components exposed to plugins via window.__AGEMON__.PluginKitContext
 * and window.__AGEMON__.host.
 *
 * Plugins access these via:
 *   import { X } from '@agemon/host';
 * which resolves to window.__AGEMON__.host.X at runtime.
 *
 * We use a generic component type rather than importing ComponentType from react
 * so this file stays usable in shared/ without a react dependency.
 */

/** Minimal React component type (function or class returning JSX or null). */
type ReactComponent<P = Record<string, unknown>> = (props: P) => unknown;

export interface PluginKit {
  /** Renders the session list for a given task. */
  SessionList: ReactComponent<{
    taskId: string;
    selectedSessionId?: string;
    onSelect: (sessionId: string) => void;
  }>;

  /** Renders the full chat panel for a given task + session. taskId optional for standalone sessions. */
  ChatPanel: ReactComponent<{
    taskId?: string | null;
    sessionId: string;
  }>;

  /** Renders a status badge for a task status string. */
  StatusBadge: ReactComponent<{
    status: string;
  }>;

  /** Renders a diff viewer for a session's workspace changes */
  DiffViewer: ReactComponent<{
    sessionId: string;
    live?: boolean;
  }>;

  /** Renders a file tree for a session or task workspace */
  FileTreeViewer: ReactComponent<{
    mode: 'session' | 'task';
    sessionId?: string;
    taskId?: string;
  }>;

  /** Renders the MCP server list for global or task scope */
  McpServerList: ReactComponent<{
    scope: 'global' | 'task';
    taskId?: string;
  }>;
}

/** Partial version used as the context default — all members optional. */
export type PartialPluginKit = {
  [K in keyof PluginKit]?: PluginKit[K] | null;
};

/**
 * All shadcn/ui components exposed on `window.__AGEMON__.ui`.
 * Extensions import these via `window.__AGEMON__.ui` or declare `@agemon/ui` as an external.
 */
export interface AgemonUI {
  Accordion: ReactComponent<{ type: 'single' | 'multiple'; collapsible?: boolean; defaultValue?: string; className?: string; children?: unknown }>;
  AccordionContent: ReactComponent<{ className?: string; children?: unknown }>;
  AccordionItem: ReactComponent<{ value: string; className?: string; children?: unknown }>;
  AccordionTrigger: ReactComponent<{ className?: string; children?: unknown }>;
  Badge: ReactComponent<{ variant?: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string; children?: unknown }>;
  Button: ReactComponent<{ variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'; size?: 'default' | 'sm' | 'lg' | 'icon'; disabled?: boolean; onClick?: () => void; className?: string; children?: unknown; type?: 'button' | 'submit' | 'reset' }>;
  Card: ReactComponent<{ className?: string; children?: unknown }>;
  CardContent: ReactComponent<{ className?: string; children?: unknown }>;
  CardHeader: ReactComponent<{ className?: string; children?: unknown }>;
  CardTitle: ReactComponent<{ className?: string; children?: unknown }>;
  Input: ReactComponent<{ value?: string; defaultValue?: string; placeholder?: string; disabled?: boolean; type?: string; className?: string; onChange?: (e: unknown) => void; onKeyDown?: (e: unknown) => void }>;
  Label: ReactComponent<{ htmlFor?: string; className?: string; children?: unknown }>;
  Select: ReactComponent<{ value?: string; defaultValue?: string; onValueChange?: (value: string) => void; disabled?: boolean; children?: unknown }>;
  SelectContent: ReactComponent<{ className?: string; children?: unknown }>;
  SelectItem: ReactComponent<{ value: string; className?: string; children?: unknown }>;
  SelectTrigger: ReactComponent<{ className?: string; children?: unknown }>;
  SelectValue: ReactComponent<{ placeholder?: string; className?: string }>;
  Switch: ReactComponent<{ checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (checked: boolean) => void; disabled?: boolean; className?: string }>;
  Textarea: ReactComponent<{ value?: string; defaultValue?: string; placeholder?: string; disabled?: boolean; rows?: number; className?: string; onChange?: (e: unknown) => void }>;
}
