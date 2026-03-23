/**
 * Standalone session detail view — fullscreen chat, no task wrapper.
 * Route: /sessions/:id
 */
import { useNavigate, useParams } from '@tanstack/react-router';
import { ChatPanel } from '@/components/custom/chat-panel';
import { useWsStore } from '@/lib/store';
import { useEffect } from 'react';

export default function SessionDetailPage() {
  const { id: sessionId } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();

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
      />
    </div>
  );
}
