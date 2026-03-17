import { useState } from 'react';
import { setApiKey, validateKey, setAuthCookie } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [key, setKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;

    setValidating(true);
    setError('');

    const valid = await validateKey(trimmed);
    if (!valid) {
      setError('Invalid API key or server unreachable');
      setValidating(false);
      return;
    }

    setApiKey(trimmed);
    await setAuthCookie(trimmed);
    onLogin();
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Agemon</h1>
          <p className="text-sm text-muted-foreground">Enter your API key to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agemon-key">API Key</Label>
            <Input
              id="agemon-key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="AGEMON_KEY"
              autoComplete="current-password"
              className="h-11"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            className="w-full h-11"
            disabled={!key.trim() || validating}
          >
            {validating ? 'Validating...' : 'Connect'}
          </Button>
        </form>
      </div>
    </div>
  );
}
