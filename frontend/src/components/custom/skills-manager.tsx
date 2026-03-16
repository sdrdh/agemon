import { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2, Plus, Search, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { InstalledSkill, SkillPreview } from '@agemon/shared';

type AddStep = 'source' | 'preview' | 'installing';

export function SkillsManager({
  scope,
}: {
  scope: 'global' | { taskId: string };
}) {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [globalSkills, setGlobalSkills] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState('');
  const [deletingName, setDeletingName] = useState<string | null>(null);

  // Add flow state
  const [addStep, setAddStep] = useState<AddStep>('source');
  const [source, setSource] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewSkills, setPreviewSkills] = useState<SkillPreview[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);

  const load = useCallback(async () => {
    try {
      if (scope === 'global') {
        const result = await api.listGlobalSkills();
        setSkills(result.skills);
      } else {
        const result = await api.listTaskSkills(scope.taskId);
        setSkills(result.task);
        setGlobalSkills(result.global);
      }
    } catch {
      // empty
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  function resetAddFlow() {
    setShowAdd(false);
    setAddStep('source');
    setSource('');
    setPreviewSkills([]);
    setSelectedSkills(new Set());
    setError('');
    setPreviewing(false);
    setInstalling(false);
  }

  async function handlePreview() {
    if (!source.trim()) return;
    setPreviewing(true);
    setError('');
    try {
      const result = await api.previewSkills(source.trim());
      if (!result.ok || result.skills.length === 0) {
        setError(result.error ?? 'No skills found in this source');
        return;
      }
      setPreviewSkills(result.skills);
      // Select all by default
      setSelectedSkills(new Set(result.skills.map(s => s.name)));
      setAddStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch skills');
    } finally {
      setPreviewing(false);
    }
  }

  function toggleSkill(name: string) {
    setSelectedSkills(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    if (selectedSkills.size === previewSkills.length) {
      setSelectedSkills(new Set());
    } else {
      setSelectedSkills(new Set(previewSkills.map(s => s.name)));
    }
  }

  async function handleInstall() {
    if (selectedSkills.size === 0) return;
    setInstalling(true);
    setAddStep('installing');
    setError('');
    try {
      const skillNames = selectedSkills.size === previewSkills.length
        ? undefined  // install all — no need to filter
        : [...selectedSkills];
      const result = scope === 'global'
        ? await api.installGlobalSkill(source.trim(), skillNames)
        : await api.installTaskSkill(scope.taskId, source.trim(), skillNames);
      if (!result.ok) {
        setError(result.error ?? 'Installation failed');
        setAddStep('preview');
      } else {
        resetAddFlow();
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
      setAddStep('preview');
    } finally {
      setInstalling(false);
    }
  }

  async function handleDelete(skill: InstalledSkill) {
    setDeletingName(skill.name);
    setError('');
    try {
      if (scope === 'global') {
        await api.removeGlobalSkill(skill.name);
      } else {
        await api.removeTaskSkill(scope.taskId, skill.name);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setDeletingName(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasAny = skills.length > 0 || globalSkills.length > 0;

  return (
    <div className="space-y-3">
      {/* Inherited global skills (task scope only) */}
      {scope !== 'global' && globalSkills.length > 0 && (
        <div className="space-y-1.5 opacity-60">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium px-1">
            Global
          </p>
          {globalSkills.map((skill) => (
            <SkillCard key={`global-${skill.name}`} skill={skill} />
          ))}
        </div>
      )}

      {/* Scoped skills */}
      {skills.length > 0 && (
        <div className="space-y-1.5">
          {skills.map((skill) => (
            <SkillCard
              key={`${skill.scope}-${skill.name}`}
              skill={skill}
              deleting={deletingName === skill.name}
              onDelete={() => handleDelete(skill)}
            />
          ))}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {!hasAny && !showAdd && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No skills installed. Add skills from GitHub repositories to extend agent capabilities.
        </p>
      )}

      {showAdd ? (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          {/* Step 1: Enter source */}
          {addStep === 'source' && (
            <>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !previewing && handlePreview()}
                placeholder="owner/repo or GitHub URL"
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={previewing}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  onClick={handlePreview}
                  disabled={previewing || !source.trim()}
                  className="min-h-[44px] flex-1"
                >
                  {previewing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Fetching skills...
                    </>
                  ) : (
                    <>
                      <Search className="h-3.5 w-3.5 mr-1.5" />
                      Preview Skills
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetAddFlow}
                  disabled={previewing}
                  className="min-h-[44px]"
                >
                  Cancel
                </Button>
              </div>
            </>
          )}

          {/* Step 2: Select skills to install */}
          {addStep === 'preview' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {previewSkills.length} skill{previewSkills.length !== 1 ? 's' : ''} available
                </p>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs text-primary hover:underline"
                >
                  {selectedSkills.size === previewSkills.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {previewSkills.map((skill) => (
                  <label
                    key={skill.name}
                    className="flex items-start gap-3 rounded-md px-3 py-2 cursor-pointer hover:bg-muted/50 min-h-[44px]"
                  >
                    <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                      selectedSkills.has(skill.name)
                        ? 'bg-primary border-primary'
                        : 'border-input'
                    }`}>
                      {selectedSkills.has(skill.name) && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedSkills.has(skill.name)}
                      onChange={() => toggleSkill(skill.name)}
                      className="sr-only"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{skill.name}</span>
                      {skill.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {skill.description}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleInstall}
                  disabled={selectedSkills.size === 0}
                  className="min-h-[44px] flex-1"
                >
                  Install {selectedSkills.size} skill{selectedSkills.size !== 1 ? 's' : ''}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setAddStep('source'); setError(''); }}
                  className="min-h-[44px]"
                >
                  Back
                </Button>
              </div>
            </>
          )}

          {/* Step 3: Installing */}
          {addStep === 'installing' && (
            <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Installing {selectedSkills.size} skill{selectedSkills.size !== 1 ? 's' : ''}...
            </div>
          )}
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => setShowAdd(true)}
          className="w-full"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Skill
        </Button>
      )}
    </div>
  );
}

function SkillCard({
  skill,
  deleting,
  onDelete,
}: {
  skill: InstalledSkill;
  deleting?: boolean;
  onDelete?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="rounded-lg border bg-card px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{skill.name}</span>
          <span className="shrink-0 text-[10px] font-medium border rounded px-1.5 py-0.5 text-muted-foreground capitalize">
            {skill.scope}
          </span>
        </div>
        {skill.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {skill.description}
          </p>
        )}
      </div>
      {onDelete && (
        confirmDelete ? (
          <div className="flex gap-1 shrink-0">
            <Button
              size="sm"
              variant="destructive"
              className="h-8 px-2 text-xs"
              onClick={() => { onDelete(); setConfirmDelete(false); }}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Remove'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )
      )}
    </div>
  );
}
