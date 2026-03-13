import { useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { Send, Ban, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SlashCommandMenu } from '@/components/custom/slash-command-menu';
import type { AgentCommand } from '@agemon/shared';

/** Input border/bg color per mode */
const MODE_INPUT_STYLES: Record<string, string> = {
  default: '',
  plan: 'border-amber-400/60 bg-amber-50/30 dark:bg-amber-950/20',
  acceptEdits: 'border-blue-400/60 bg-blue-50/30 dark:bg-blue-950/20',
  dontAsk: 'border-orange-400/60 bg-orange-50/30 dark:bg-orange-950/20',
  bypassPermissions: 'border-red-400/60 bg-red-50/30 dark:bg-red-950/20',
};

export function ChatInputArea({
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
  onSetInputText,
  onSend,
  onCancelTurn,
  onResume,
  onSelectCommand,
  onSetSelectedCommandIdx,
  onAdjustTextareaHeight,
}: {
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
  onSetInputText: (text: string) => void;
  onSend: () => void;
  onCancelTurn: () => void;
  onResume: () => void;
  onSelectCommand: (cmd: AgentCommand) => void;
  onSetSelectedCommandIdx: (idx: number | ((prev: number) => number)) => void;
  onAdjustTextareaHeight: (el: HTMLTextAreaElement) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const showCommandMenu = filteredCommands.length > 0;

  // Reset height when input is cleared (after send)
  useEffect(() => {
    if (!inputText && inputRef.current) {
      inputRef.current.style.height = '';
    }
  }, [inputText]);

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
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => {
              onSetInputText(e.target.value);
              onAdjustTextareaHeight(e.target);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={inputPlaceholder}
            disabled={!canType && !sessionReady}
            rows={1}
            className={`flex-1 min-h-[44px] max-h-[40vh] resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${MODE_INPUT_STYLES[currentMode] ?? ''}`}
          />
          {turnInFlight ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              onClick={onCancelTurn}
              className="min-h-[44px] min-w-[44px]"
              aria-label="Cancel turn"
            >
              <Ban className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={onSend}
              disabled={(!canType && !sessionReady) || !inputText.trim()}
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
