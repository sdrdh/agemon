import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, Monitor, Moon, Sun, Palette, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme-provider';
import { THEMES, getThemeDef, type ColorMode, type ThemeId } from '@/lib/theme';
import { McpServerList } from '@/components/custom/mcp-server-list';

type Section = 'appearance' | 'mcp-servers';

const SECTIONS: { id: Section; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'mcp-servers', label: 'MCP Servers', icon: Plug },
];

// ─── Appearance Section ─────────────────────────────────────────────────────

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
      <div
        className="w-full h-10 rounded-md border border-border/50 overflow-hidden flex items-end"
        style={{ backgroundColor: def.preview.bg }}
      >
        <div className="h-1.5 w-full" style={{ backgroundColor: def.preview.primary }} />
      </div>
      <span className="text-xs font-medium text-center leading-tight">{def.name}</span>
      {def.darkOnly && (
        <span className="absolute top-1 right-1 text-[9px] bg-muted text-muted-foreground px-1 rounded">
          dark
        </span>
      )}
      {selected && (
        <span className="absolute top-1 left-1 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
          <Check className="h-2.5 w-2.5 text-primary-foreground" />
        </span>
      )}
    </button>
  );
}

function AppearanceSection() {
  const { themeId, colorMode, setTheme, setColorMode } = useTheme();
  const currentDef = getThemeDef(themeId);

  return (
    <section className="space-y-6">
      <h2 className="text-sm font-semibold">Appearance</h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {THEMES.map((t) => (
          <ThemeSwatchCard
            key={t.id}
            themeId={t.id}
            selected={themeId === t.id}
            onSelect={() => setTheme(t.id)}
          />
        ))}
      </div>

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
  );
}

// ─── MCP Servers Section ────────────────────────────────────────────────────

function McpServersSection() {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">MCP Servers</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Global servers are available to all agent sessions. Override per-task from the task info drawer.
        </p>
      </div>
      <McpServerList scope="global" />
    </section>
  );
}

// ─── Settings Page ──────────────────────────────────────────────────────────

export default function SettingsPage() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>('appearance');

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" aria-label="Back" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <div className="md:flex md:min-h-[calc(100vh-52px)]">
        {/* Mobile: icon-only top tabs */}
        <div className="md:hidden flex border-b bg-muted/30">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`flex-1 flex items-center justify-center py-3 min-h-[44px] transition-colors border-b-2 ${
                activeSection === id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              aria-label={label}
              title={label}
            >
              <Icon className="h-5 w-5" />
            </button>
          ))}
        </div>

        {/* Desktop: sidebar with icon + label */}
        <nav className="hidden md:flex md:flex-col md:w-48 md:shrink-0 md:border-r md:bg-muted/20 md:py-2 md:px-2 md:gap-0.5">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium min-h-[44px] transition-colors text-left ${
                activeSection === id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 p-4 md:p-6 max-w-2xl">
          {activeSection === 'appearance' && <AppearanceSection />}
          {activeSection === 'mcp-servers' && <McpServersSection />}
        </div>
      </div>
    </div>
  );
}
