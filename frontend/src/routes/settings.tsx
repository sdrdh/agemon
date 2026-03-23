import { useState, useEffect } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Check, Monitor, Moon, Sun, Palette, Plug, Info, Zap, LogOut, Puzzle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/lib/theme-provider';
import { THEMES, getThemeDef, type ColorMode, type ThemeId } from '@/lib/theme';
import { McpServerList } from '@/components/custom/mcp-server-list';
import { SkillsManager } from '@/components/custom/skills-manager';
import { useVersionChecker } from '@/hooks/use-version-checker';
import { api } from '@/lib/api';
import type { UpdateResult, ReleaseChannel } from '@agemon/shared';
import { RELEASE_CHANNELS } from '@agemon/shared';

type Section = 'appearance' | 'mcp-servers' | 'skills' | 'plugins' | 'about';

const SECTIONS: { id: Section; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'mcp-servers', label: 'MCP Servers', icon: Plug },
  { id: 'skills', label: 'Skills', icon: Zap },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'about', label: 'About', icon: Info },
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

// ─── Skills Section ──────────────────────────────────────────────────────────

function SkillsSection() {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Skills</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Global skills are available to all agent sessions. Install from GitHub repositories.
        </p>
      </div>
      <SkillsManager scope="global" />
    </section>
  );
}

// ─── Plugins Section ────────────────────────────────────────────────────────

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  hasPages: boolean;
  navLabel?: string | null;
  navEnabled: boolean;
  showInSettings: boolean;
}

function PluginsSection() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/plugins', { credentials: 'include' })
      .then(res => res.json())
      .then((all: PluginInfo[]) => setPlugins(all.filter(p => p.showInSettings !== false)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function toggleNav(pluginId: string, enabled: boolean) {
    setPlugins(prev => prev.map(p => p.id === pluginId ? { ...p, navEnabled: enabled } : p));
    fetch(`/api/plugins/${pluginId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navEnabled: enabled }),
    }).catch(console.error);
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Plugins</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Drop a plugin folder into <span className="font-mono">~/.agemon/plugins/</span> and restart the server to install.
        </p>
      </div>

      {loading && (
        <div className="space-y-2">
          <div className="h-14 rounded-lg bg-muted animate-pulse" />
          <div className="h-14 rounded-lg bg-muted animate-pulse" />
        </div>
      )}

      {!loading && plugins.length === 0 && (
        <div className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">
          <Puzzle className="h-6 w-6 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No plugins installed</p>
        </div>
      )}

      {!loading && plugins.length > 0 && (
        <ul className="space-y-2">
          {plugins.map((p) => (
            <li key={p.id} className="px-4 py-3 bg-card rounded-lg border space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{p.name}</div>
                  {p.description && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground font-mono">{p.version}</span>
                  {p.hasPages && (
                    <Link
                      to="/p/$pluginId"
                      params={{ pluginId: p.id }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={`Open ${p.name}`}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              </div>
              {p.navLabel && (
                <div className="flex items-center justify-between pt-1 border-t border-border/50">
                  <Label htmlFor={`nav-${p.id}`} className="text-xs text-muted-foreground">Show in nav</Label>
                  <Switch
                    id={`nav-${p.id}`}
                    checked={p.navEnabled}
                    onCheckedChange={(checked) => toggleNav(p.id, checked)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── About Section ─────────────────────────────────────────────────────────

const RESTART_POLL_INTERVAL_MS = 2000;
const RESTART_POLL_MAX_ATTEMPTS = 30;

function AboutSection({ onLogout }: { onLogout: () => void }) {
  const { versionInfo, loading: checkLoading, error: checkError, check } = useVersionChecker();
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [isSystemd, setIsSystemd] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [autoUpgrade, setAutoUpgrade] = useState(false);
  const [autoResume, setAutoResume] = useState(false);
  const [releaseChannel, setReleaseChannel] = useState<ReleaseChannel>('stable');
  const [releaseBranch, setReleaseBranch] = useState('');
  const [branchInput, setBranchInput] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load version + settings on mount (parallel)
  useEffect(() => {
    Promise.all([
      api.getVersion().catch(() => null),
      api.getSettings().catch(() => null),
    ]).then(([version, settings]) => {
      if (version) {
        setCurrentVersion(version.current);
        setIsSystemd(version.running_under_systemd);
      }
      if (settings) {
        setAutoUpgrade(settings.auto_upgrade === 'true');
        setAutoResume(settings.auto_resume_sessions === 'true');
        const ch = (settings.release_channel as ReleaseChannel) || 'stable';
        setReleaseChannel(ch);
        const br = settings.release_branch || '';
        setReleaseBranch(br);
        setBranchInput(br);
      }
      setSettingsLoaded(true);
    });
  }, []);

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      const result = await api.applyUpdate();
      setUpdateResult(result);
    } catch (err) {
      setUpdateResult({ ok: false, method: 'git', from_version: '', to_version: '', message: (err as Error).message });
    } finally {
      setUpdating(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    setRestartError(null);
    try {
      await api.restart();
      // Poll until server comes back
      for (let i = 0; i < RESTART_POLL_MAX_ATTEMPTS; i++) {
        await new Promise(r => setTimeout(r, RESTART_POLL_INTERVAL_MS));
        try {
          const res = await fetch('/api/health');
          if (res.ok) { window.location.reload(); return; }
        } catch { /* still down */ }
      }
      setRestartError('Server did not come back. Check systemd logs.');
    } catch (err) {
      setRestartError((err as Error).message);
    } finally {
      setRestarting(false);
    }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    setRebuildResult(null);
    try {
      const result = await api.rebuild();
      if (!result.ok) {
        setRebuildResult(result);
        return;
      }
      // Build succeeded — server will restart; poll until it's back
      for (let i = 0; i < RESTART_POLL_MAX_ATTEMPTS; i++) {
        await new Promise(r => setTimeout(r, RESTART_POLL_INTERVAL_MS));
        try {
          const res = await fetch('/api/health');
          if (res.ok) { window.location.reload(); return; }
        } catch { /* still down */ }
      }
      setRebuildResult({ ok: false, message: 'Server did not come back. Check systemd logs.' });
    } catch (err) {
      setRebuildResult({ ok: false, message: (err as Error).message });
    } finally {
      setRebuilding(false);
    }
  };

  const toggleSetting = async (key: string, current: boolean, setter: (v: boolean) => void) => {
    const newValue = !current;
    setter(newValue);
    await api.setSetting(key, String(newValue)).catch(() => setter(current));
  };

  const handleChannelChange = async (newChannel: ReleaseChannel) => {
    setReleaseChannel((prev) => {
      // Optimistic update; rollback handled in catch via functional setState
      api.setSetting('release_channel', newChannel)
        .then(() => check(true))
        .catch(() => setReleaseChannel(prev));
      return newChannel;
    });
    setUpdateResult(null);
  };

  const handleBranchSave = async () => {
    const trimmed = branchInput.trim();
    if (!trimmed) return;
    setReleaseBranch((prev) => {
      api.setSetting('release_branch', trimmed)
        .then(() => check(true))
        .catch(() => setReleaseBranch(prev));
      return trimmed;
    });
    setUpdateResult(null);
  };

  return (
    <section className="space-y-6">
      <h2 className="text-sm font-semibold">About & Updates</h2>

      {/* Version info */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Current version</span>
          <span className="text-sm font-mono">{currentVersion ?? '...'}</span>
        </div>
        {versionInfo && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {versionInfo.channel === 'branch' ? 'Latest commit' : 'Latest version'}
              </span>
              <span className="text-sm font-mono">{versionInfo.latest || '—'}</span>
            </div>
            {versionInfo.published_at && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Published</span>
                <span className="text-sm">{new Date(versionInfo.published_at).toLocaleDateString()}</span>
              </div>
            )}
          </>
        )}
        {checkError && (
          <p className="text-xs text-destructive">{checkError}</p>
        )}
      </div>

      {/* Release channel picker */}
      {settingsLoaded && (
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Release Channel
          </h3>
          <div className="inline-flex rounded-lg border bg-muted/50 p-1 gap-1 flex-wrap">
            {RELEASE_CHANNELS.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => handleChannelChange(ch)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium min-h-[36px] transition-colors capitalize ${
                  releaseChannel === ch
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {releaseChannel === 'stable' && 'Track official releases only.'}
            {releaseChannel === 'pre-release' && 'Include release candidates and beta versions.'}
            {releaseChannel === 'nightly' && 'Track nightly builds (may be unstable).'}
            {releaseChannel === 'branch' && 'Track a specific git branch.'}
          </p>
          {releaseChannel === 'branch' && (
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={branchInput}
                onChange={(e) => setBranchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBranchSave()}
                placeholder="e.g. main, develop, feat/my-branch"
                className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                variant="outline"
                className="min-h-[44px]"
                onClick={handleBranchSave}
                disabled={!branchInput.trim() || branchInput.trim() === releaseBranch}
              >
                {releaseBranch ? 'Update' : 'Set'}
              </Button>
            </div>
          )}
          {releaseChannel === 'branch' && releaseBranch && (
            <p className="text-xs text-muted-foreground">
              Tracking branch: <span className="font-mono text-foreground">{releaseBranch}</span>
            </p>
          )}
        </div>
      )}

      {/* Check / Update / Restart buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="min-h-[44px]"
          onClick={() => check(true)}
          disabled={checkLoading}
        >
          {checkLoading ? 'Checking...' : 'Check for Updates'}
        </Button>

        {versionInfo?.has_update && !updateResult?.ok && (
          <Button
            className="min-h-[44px]"
            onClick={handleUpdate}
            disabled={updating}
          >
            {updating ? 'Updating...' : versionInfo.channel === 'branch' ? `Pull latest` : `Update to v${versionInfo.latest}`}
          </Button>
        )}

        {updateResult?.ok && isSystemd && (
          <Button
            className="min-h-[44px]"
            onClick={handleRestart}
            disabled={restarting}
          >
            {restarting ? 'Restarting...' : 'Restart Server'}
          </Button>
        )}

        {updateResult?.ok && !isSystemd && (
          <p className="text-sm text-muted-foreground self-center">
            Updated! Restart the server manually to apply.
          </p>
        )}
      </div>

      {updateResult && (
        updateResult.ok ? (
          <p className="text-xs text-success">{updateResult.message}</p>
        ) : (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
            <p className="text-sm font-medium text-destructive">Update failed</p>
            <p className="text-xs text-destructive/80 mt-0.5">{updateResult.message}</p>
          </div>
        )
      )}
      {restartError && (
        <p className="text-xs text-destructive">{restartError}</p>
      )}

      {/* Rebuild & Restart */}
      {isSystemd && (
        <div className="space-y-2 pt-2 border-t">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Development
          </h3>
          <p className="text-xs text-muted-foreground">
            Rebuild the frontend from the current working tree and restart the server.
          </p>
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={handleRebuild}
            disabled={rebuilding}
          >
            {rebuilding ? 'Building...' : 'Rebuild & Restart'}
          </Button>
          {rebuildResult && (
            rebuildResult.ok ? (
              <p className="text-xs text-success">{rebuildResult.message}</p>
            ) : (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
                <p className="text-sm font-medium text-destructive">Build failed</p>
                <pre className="text-xs text-destructive/80 mt-1 whitespace-pre-wrap">{rebuildResult.message}</pre>
              </div>
            )
          )}
        </div>
      )}

      {/* Settings toggles */}
      {settingsLoaded && (
        <div className="space-y-3 pt-2 border-t">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Automation
          </h3>

          <label className="flex items-center justify-between min-h-[44px] cursor-pointer">
            <div>
              <span className="text-sm">Auto-upgrade on startup</span>
              <p className="text-xs text-muted-foreground">Automatically update when server restarts (systemd only)</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoUpgrade}
              onClick={() => toggleSetting('auto_upgrade', autoUpgrade, setAutoUpgrade)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${autoUpgrade ? 'bg-primary' : 'bg-muted'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition-transform ${autoUpgrade ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </label>

          <label className="flex items-center justify-between min-h-[44px] cursor-pointer">
            <div>
              <span className="text-sm">Auto-resume sessions</span>
              <p className="text-xs text-muted-foreground">Automatically resume interrupted agent sessions on startup</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoResume}
              onClick={() => toggleSetting('auto_resume_sessions', autoResume, setAutoResume)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${autoResume ? 'bg-primary' : 'bg-muted'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition-transform ${autoResume ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </label>
        </div>
      )}

      <div className="pt-4 border-t">
        <Button
          variant="outline"
          className="min-h-[44px] text-destructive hover:text-destructive"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Log out
        </Button>
      </div>
    </section>
  );
}

// ─── Settings Page ──────────────────────────────────────────────────────────

export default function SettingsPage() {
  const navigate = useNavigate();
  const { options: { context } } = useRouter();
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
          {activeSection === 'skills' && <SkillsSection />}
          {activeSection === 'plugins' && <PluginsSection />}
          {activeSection === 'about' && <AboutSection onLogout={context.onLogout} />}
        </div>
      </div>
    </div>
  );
}
