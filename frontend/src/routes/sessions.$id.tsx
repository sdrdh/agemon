/**
 * Standalone session detail view — fullscreen chat, no task wrapper.
 * Route: /sessions/:id
 */
import { useNavigate, useParams } from '@tanstack/react-router';
import { ChatPanel } from '@/components/custom/chat-panel';
import { DiffViewer } from '@/components/custom/diff-viewer';
import { useWsStore } from '@/lib/store';
import { useEffect, useState } from 'react';

export default function SessionDetailPage() {
  const { id: sessionId } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const [diffOpen, setDiffOpen] = useState(false);

  // Signal fullscreen layout to host chrome
  const setHostLayout = useWsStore((s) => s.setHostLayout);
  useEffect(() => {
    setHostLayout('fullscreen');
    return () => { setHostLayout('default'); };
  }, [setHostLayout]);

  const handleBack = () => {
    navigate({ to: '/sessions', search: { taskId: undefined } });
  };

  return (
    <div className="flex flex-col h-dvh">
      <ChatPanel
        sessionId={sessionId}
        onBack={handleBack}
        onDiff={() => setDiffOpen(true)}
      />

      {diffOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/40"
            onClick={() => setDiffOpen(false)}
          />
          <div className="fixed inset-4 z-50 bg-background border rounded-lg shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <h2 className="text-sm font-semibold">Changes</h2>
              <button
                onClick={() => setDiffOpen(false)}
                className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <DiffViewer sessionId={sessionId} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
