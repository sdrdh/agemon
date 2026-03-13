import type { AgentCommand } from '@agemon/shared';

export function SlashCommandMenu({
  filteredCommands,
  selectedCommandIdx,
  onSelectCommand,
  onMouseEnter,
}: {
  filteredCommands: AgentCommand[];
  selectedCommandIdx: number;
  onSelectCommand: (cmd: AgentCommand) => void;
  onMouseEnter: (idx: number) => void;
}) {
  if (filteredCommands.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md border bg-popover text-popover-foreground shadow-md max-h-[240px] overflow-y-auto z-50">
      {filteredCommands.map((cmd, idx) => (
        <button
          key={cmd.name}
          type="button"
          className={`w-full text-left px-3 py-2.5 min-h-[44px] flex flex-col gap-0.5 transition-colors ${
            idx === selectedCommandIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
          }`}
          onMouseDown={(e) => {
            e.preventDefault(); // prevent input blur
            onSelectCommand(cmd);
          }}
          onMouseEnter={() => onMouseEnter(idx)}
        >
          <span className="text-sm font-medium">/{cmd.name}</span>
          {cmd.description && (
            <span className="text-xs text-muted-foreground truncate">{cmd.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}
