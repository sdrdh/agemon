import { ConfigOptionPicker } from '@/components/custom/config-option-picker';
import type { SessionConfigOption } from '@agemon/shared';

/** Input border/bg color per mode */
const MODE_BADGE_STYLES: Record<string, string> = {
  default: 'bg-muted text-muted-foreground hover:bg-muted/80',
  plan: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60',
  acceptEdits: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60',
  dontAsk: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/60',
  bypassPermissions: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60',
};

export function SessionModeBar({
  modeOption,
  modelOption,
  currentMode,
  sessionRunning,
  onCycleMode,
  onConfigChange,
}: {
  modeOption: SessionConfigOption | null;
  modelOption: SessionConfigOption | null;
  currentMode: string;
  sessionRunning: boolean;
  onCycleMode: () => void;
  onConfigChange: (configId: string, value: string) => void;
}) {
  if (!modeOption && !modelOption) return null;

  return (
    <div className="flex items-center gap-2 mt-2">
      {modeOption && (
        <button
          type="button"
          onClick={onCycleMode}
          disabled={!sessionRunning}
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors min-h-[28px] disabled:opacity-50 ${MODE_BADGE_STYLES[currentMode] ?? 'bg-muted text-muted-foreground'}`}
        >
          {modeOption.options.find(o => o.value === currentMode)?.label ?? currentMode}
        </button>
      )}
      {modelOption && (
        <ConfigOptionPicker
          option={modelOption}
          onValueChange={onConfigChange}
          disabled={!sessionRunning}
        />
      )}
    </div>
  );
}
