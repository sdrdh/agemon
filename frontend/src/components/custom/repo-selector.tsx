import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { SSH_REPO_REGEX } from '@agemon/shared';
import type { Repo } from '@agemon/shared';

interface RepoSelectorProps {
  selected: string[];
  onChange: (urls: string[]) => void;
}

export function RepoSelector({ selected, onChange }: RepoSelectorProps) {
  const [registryRepos, setRegistryRepos] = useState<Repo[]>([]);
  const [showAddInput, setShowAddInput] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [error, setError] = useState('');
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    api.listRepos()
      .then(setRegistryRepos)
      .catch((err: unknown) => setFetchError(err instanceof Error ? err.message : 'Failed to load repos'));
  }, []);

  const selectedSet = new Set(selected);

  function toggleRepo(url: string) {
    if (selectedSet.has(url)) {
      onChange(selected.filter(u => u !== url));
    } else {
      onChange([...selected, url]);
    }
  }

  function addNewRepo() {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    if (!SSH_REPO_REGEX.test(trimmed)) {
      setError('Must be SSH format: git@host:org/repo.git');
      return;
    }
    if (selectedSet.has(trimmed)) {
      setError('Already selected');
      return;
    }
    onChange([...selected, trimmed]);
    setNewUrl('');
    setError('');
    setShowAddInput(false);
  }

  const registryUrls = new Set(registryRepos.map(r => r.url));
  const extraSelected = selected.filter(url => !registryUrls.has(url));

  return (
    <div className="space-y-2">
      <Label>Repositories</Label>

      {fetchError && (
        <p className="text-sm text-destructive">{fetchError}</p>
      )}

      {registryRepos.map(repo => (
        <label
          key={repo.id}
          className="flex items-center gap-3 min-h-[44px] px-2 rounded-md hover:bg-accent cursor-pointer"
        >
          <input
            type="checkbox"
            checked={selectedSet.has(repo.url)}
            onChange={() => toggleRepo(repo.url)}
            className="h-5 w-5 rounded border-input"
          />
          <span className="text-sm">{repo.name}</span>
        </label>
      ))}

      {extraSelected.map(url => (
        <div key={url} className="flex items-center gap-3 min-h-[44px] px-2">
          <input
            type="checkbox"
            checked
            onChange={() => toggleRepo(url)}
            className="h-5 w-5 rounded border-input"
          />
          <span className="text-sm font-mono">{url}</span>
        </div>
      ))}

      {showAddInput ? (
        <div className="space-y-2 pt-1">
          <div className="flex gap-2">
            <Input
              value={newUrl}
              onChange={e => { setNewUrl(e.target.value); setError(''); }}
              placeholder="git@github.com:org/repo.git"
              onKeyDown={e => e.key === 'Enter' && addNewRepo()}
              className="h-11 font-mono text-sm"
            />
            <Button size="icon" variant="ghost" onClick={() => { setShowAddInput(false); setNewUrl(''); setError(''); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button variant="secondary" onClick={addNewRepo} className="w-full">
            Add
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => setShowAddInput(true)}
        >
          <Plus className="h-4 w-4" />
          Add repository
        </Button>
      )}
    </div>
  );
}
