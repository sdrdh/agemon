/**
 * Standalone session detail view — fullscreen chat, no task wrapper.
 * Route: /sessions/:id
 */
import { useNavigate, useParams } from '@tanstack/react-router';
import { ChatPanel } from '@/components/custom/chat-panel';
import { DiffViewer } from '@/components/custom/diff-viewer';
import { FileTreeViewer } from '@/components/custom/file-tree-viewer';
import { useWsStore } from '@/lib/store';
import { useEffect, useRef, useState } from 'react';
import { authHeaders } from '@/lib/api';
import type { RepoDiff } from '@/components/custom/diff-viewer';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-4 z-50 bg-background border rounded-lg shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center">✕</button>
        </div>
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </>
  );
}

export default function SessionDetailPage() {
  const { id: sessionId } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const [diffOpen, setDiffOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [repos, setRepos] = useState<RepoDiff[]>([]);
  const reposFetched = useRef(false);

  const setHostLayout = useWsStore((s) => s.setHostLayout);
  useEffect(() => {
    setHostLayout('fullscreen');
    return () => { setHostLayout('default'); };
  }, [setHostLayout]);

  // Fetch diff repos once when either panel first opens
  useEffect(() => {
    if (!diffOpen && !filesOpen) return;
    if (reposFetched.current) return;
    reposFetched.current = true;
    fetch(`/api/sessions/${sessionId}/diff`, { headers: authHeaders(), credentials: 'include' })
      .then(r => r.json())
      .then((data: { repos?: RepoDiff[] }) => setRepos(data.repos ?? []))
      .catch(() => {});
  }, [diffOpen, filesOpen, sessionId]);

  const handleBack = () => {
    navigate({ to: '/sessions', search: { taskId: undefined } });
  };

  return (
    <div className="flex flex-col h-dvh">
      <ChatPanel
        sessionId={sessionId}
        onBack={handleBack}
        onDiff={() => setDiffOpen(true)}
        onFiles={() => setFilesOpen(true)}
      />

      {diffOpen && (
        <Modal title="Changes" onClose={() => setDiffOpen(false)}>
          <DiffViewer sessionId={sessionId} repos={repos} />
        </Modal>
      )}

      {filesOpen && (
        <Modal title="Files" onClose={() => setFilesOpen(false)}>
          <FileTreeViewer mode="session" sessionId={sessionId} diffRepos={repos} />
        </Modal>
      )}
    </div>
  );
}
