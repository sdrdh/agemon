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

  /** Renders the full chat panel for a given task + session. */
  ChatPanel: ReactComponent<{
    taskId: string;
    sessionId: string;
  }>;

  /** Renders a status badge for a task status string. */
  StatusBadge: ReactComponent<{
    status: string;
  }>;
}

/** Partial version used as the context default — all members optional. */
export type PartialPluginKit = {
  [K in keyof PluginKit]?: PluginKit[K] | null;
};
