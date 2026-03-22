import { useRef, useEffect, useCallback, useState, type KeyboardEvent } from 'react';
import { Send, Ban, RotateCcw, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SlashCommandMenu } from '@/components/custom/slash-command-menu';
import type { AgentCommand } from '@agemon/shared';
import type { LoadedExtension, InputExtensionProps } from '@/lib/use-input-extensions';

/** Input border/bg color per mode */
const MODE_INPUT_STYLES: Record<string, string> = {
  default: '',
  plan: 'border-warning/60 bg-warning/10',
  acceptEdits: 'border-blue-400/60 bg-blue-50/30 dark:bg-blue-950/20',
  dontAsk: 'border-orange-400/60 bg-orange-50/30 dark:bg-orange-950/20',
  bypassPermissions: 'border-destructive/60 bg-destructive/10',
};

export function ChatInputArea({
  connected,
  sessionStopped,
  sessionReady,
  canType,
  isDone,
  turnInFlight,
  inputText,
  inputPlaceholder,
  currentMode,
  actionLoading,
  filteredCommands,
  selectedCommandIdx,
  hasNavigatedRef,
  extensions,
  activeExtensionId,
  sessionState,
  onSetInputText,
  onSend,
  onCancelTurn,
  onResume,
  onSelectCommand,
  onSetSelectedCommandIdx,
  onAdjustTextareaHeight,
  onActivateExtension,
  onDeactivateExtension,
}: {
  connected: boolean;
  sessionStopped: boolean;
  sessionReady: boolean;
  canType: boolean;
  isDone: boolean;
  turnInFlight: boolean;
  inputText: string;
  inputPlaceholder: string;
  currentMode: string;
  actionLoading: boolean;
  filteredCommands: AgentCommand[];
  selectedCommandIdx: number;
  hasNavigatedRef: React.MutableRefObject<boolean>;
  extensions: LoadedExtension[];
  activeExtensionId: string | null;
  sessionState: string;
  onSetInputText: (text: string) => void;
  onSend: (text?: string) => void;
  onCancelTurn: () => void;
  onResume: () => void;
  onSelectCommand: (cmd: AgentCommand) => void;
  onSetSelectedCommandIdx: (idx: number | ((prev: number) => number)) => void;
  onAdjustTextareaHeight: (el: HTMLTextAreaElement) => void;
  onActivateExtension: (pluginId: string, extId: string) => void;
  onDeactivateExtension: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const showCommandMenu = filteredCommands.length > 0;
  const [extensionMenuOpen, setExtensionMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Reset height when input is cleared (after send)
  useEffect(() => {
    if (!inputText && inputRef.current) {
      inputRef.current.style.height = '';
    }
  }, [inputText]);

  // Close extension menu on outside click
  useEffect(() => {
    if (!extensionMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setExtensionMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [extensionMenuOpen]);

  const handleInputKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandMenu) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        hasNavigatedRef.current = true;
        onSetSelectedCommandIdx((prev) =>
          prev <= 0 ? filteredCommands.length - 1 : prev - 1
        );
        return;
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        hasNavigatedRef.current = true;
        onSetSelectedCommandIdx((prev) =>
          prev >= filteredCommands.length - 1 ? 0 : prev + 1
        );
        return;
      } else if (e.key === 'Tab' || (e.key === 'Enter' && hasNavigatedRef.current && selectedCommandIdx >= 0)) {
        e.preventDefault();
        const cmd = filteredCommands[selectedCommandIdx];
        if (cmd) onSelectCommand(cmd);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onSetInputText('');
        return;
      }
    }

    // Shift+Enter sends; Enter inserts a newline
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if ((canType || sessionReady) && inputText.trim()) {
        onSend();
      }
    }
  }, [showCommandMenu, filteredCommands, selectedCommandIdx, onSelectCommand, onSetInputText, canType, sessionReady, inputText, onSend, hasNavigatedRef, onSetSelectedCommandIdx]);

  // Callbacks passed into extension components
  const handleInsert = useCallback((text: string) => {
    onSetInputText(inputText + text);
  }, [onSetInputText, inputText]);

  const handleSendFromExtension = useCallback((text: string) => {
    onSend(text);
  }, [onSend]);

  // Find the active extension
  const activeExt = activeExtensionId
    ? extensions.find(e => `${e.pluginId}:${e.ext.id}` === activeExtensionId)
    : null;

  const ExtComponent = activeExt?.component ?? null;
  const extProps: InputExtensionProps = {
    onInsert: handleInsert,
    onSend: handleSendFromExtension,
    onClose: onDeactivateExtension,
    connected,
    sessionState,
  };

  if (sessionStopped && !isDone) {
    return (
      <Button
        className="w-full gap-2 min-h-[44px]"
        onClick={onResume}
        disabled={actionLoading}
      >
        <RotateCcw className="h-4 w-4" />
        {actionLoading ? 'Resuming...' : 'Resume Session'}
      </Button>
    );
  }

  return (
    <>
      <div className="relative">
        <SlashCommandMenu
          filteredCommands={filteredCommands}
          selectedCommandIdx={selectedCommandIdx}
          onSelectCommand={onSelectCommand}
          onMouseEnter={onSetSelectedCommandIdx}
        />

        {/* Extension panel — shown above the input row when an extension is active */}
        {activeExt && (
          <div className="mb-2 rounded-md border bg-muted/30 p-2">
            {ExtComponent ? (
              <ExtComponent {...extProps} />
            ) : (
              <div className="flex items-center justify-center py-3 text-sm text-muted-foreground">
                Loading...
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {/* Extension toolbar button — only shown when extensions exist */}
          {extensions.length > 0 && (
            <div className="relative" ref={menuRef}>
              <Button
                type="button"
                size="icon"
                variant={activeExtensionId ? 'secondary' : 'outline'}
                onClick={() => activeExtensionId ? onDeactivateExtension() : setExtensionMenuOpen(o => !o)}
                className="min-h-[44px] min-w-[44px]"
                aria-label="Input extensions"
              >
                {activeExtensionId ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </Button>

              {extensionMenuOpen && (
                <div className="absolute bottom-full left-0 mb-1 z-50 min-w-[160px] rounded-md border bg-popover shadow-md">
                  {extensions.map((e) => (
                    <button
                      key={`${e.pluginId}:${e.ext.id}`}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent first:rounded-t-md last:rounded-b-md"
                      onClick={() => {
                        setExtensionMenuOpen(false);
                        const key = `${e.pluginId}:${e.ext.id}`;
                        if (activeExtensionId === key) {
                          onDeactivateExtension();
                        } else {
                          onActivateExtension(e.pluginId, e.ext.id);
                        }
                      }}
                    >
                      <span className="flex-1 text-left">{e.ext.label}</span>
                      {activeExtensionId === `${e.pluginId}:${e.ext.id}` && (
                        <span className="text-xs text-muted-foreground">active</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => {
              onSetInputText(e.target.value);
              onAdjustTextareaHeight(e.target);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={inputPlaceholder}
            disabled={!connected || (!canType && !sessionReady)}
            rows={1}
            className={`flex-1 min-h-[44px] max-h-[40vh] resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${MODE_INPUT_STYLES[currentMode] ?? ''}`}
          />
          {turnInFlight ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              onClick={onCancelTurn}
              disabled={!connected}
              className="min-h-[44px] min-w-[44px]"
              aria-label="Cancel turn"
            >
              <Ban className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={() => onSend()}
              disabled={!connected || (!canType && !sessionReady) || !inputText.trim()}
              className="min-h-[44px] min-w-[44px]"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
