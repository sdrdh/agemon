import { WifiOff } from 'lucide-react';
import { useWsStore } from '@/lib/store';

export function ConnectionBanner() {
  const connected = useWsStore((s) => s.connected);

  if (connected) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-center gap-2 text-sm">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>Connection lost. Reconnecting...</span>
    </div>
  );
}
