import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { useWsStore } from '@/lib/store';

/** Delay before showing the banner so it doesn't flash on page navigation. */
const SHOW_DELAY_MS = 2_000;

export function ConnectionBanner() {
  const connected = useWsStore((s) => s.connected);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (connected) {
      setVisible(false);
      return;
    }
    const id = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(id);
  }, [connected]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-center gap-2 text-sm">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>Connection lost. Reconnecting...</span>
    </div>
  );
}
