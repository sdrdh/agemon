import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme-provider';
import { THEMES, getThemeDef, type ColorMode, type ThemeId } from '@/lib/theme';

const MODE_OPTIONS: { value: ColorMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function ThemeSwatchCard({
  themeId,
  selected,
  onSelect,
}: {
  themeId: ThemeId;
  selected: boolean;
  onSelect: () => void;
}) {
  const def = getThemeDef(themeId);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 min-h-[80px] transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
      }`}
    >
      {/* Swatch preview */}
      <div
        className="w-full h-10 rounded-md border border-border/50 overflow-hidden flex items-end"
        style={{ backgroundColor: def.preview.bg }}
      >
        <div className="h-1.5 w-full" style={{ backgroundColor: def.preview.primary }} />
      </div>

      {/* Name */}
      <span className="text-xs font-medium text-center leading-tight">{def.name}</span>

      {/* Dark-only badge */}
      {def.darkOnly && (
        <span className="absolute top-1 right-1 text-[9px] bg-muted text-muted-foreground px-1 rounded">
          dark
        </span>
      )}

      {/* Selected check */}
      {selected && (
        <span className="absolute top-1 left-1 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
          <Check className="h-2.5 w-2.5 text-primary-foreground" />
        </span>
      )}
    </button>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { themeId, colorMode, setTheme, setColorMode } = useTheme();
  const currentDef = getThemeDef(themeId);

  return (
    <div>
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" aria-label="Back" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <div className="p-4 space-y-8">
        {/* Appearance section */}
        <section>
          <h2 className="text-sm font-semibold mb-4">Appearance</h2>

          {/* Theme grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {THEMES.map((t) => (
              <ThemeSwatchCard
                key={t.id}
                themeId={t.id}
                selected={themeId === t.id}
                onSelect={() => setTheme(t.id)}
              />
            ))}
          </div>

          {/* Color mode toggle */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Color Mode
            </h3>
            <div className="inline-flex rounded-lg border bg-muted/50 p-1 gap-1">
              {MODE_OPTIONS.map(({ value, label, icon: Icon }) => {
                const isActive = colorMode === value;
                const isDisabled = currentDef.darkOnly && value !== 'dark';

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setColorMode(value)}
                    disabled={isDisabled}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium min-h-[36px] transition-colors ${
                      isActive
                        ? 'bg-background text-foreground shadow-sm'
                        : isDisabled
                          ? 'text-muted-foreground/40 cursor-not-allowed'
                          : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>
            {currentDef.darkOnly && (
              <p className="text-xs text-muted-foreground mt-2">
                {currentDef.name} is a dark-only theme.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
