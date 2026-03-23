/**
 * Legacy deep-link handler: /tasks/:id → /p/tasks/:id
 * Redirects to the tasks plugin page, preserving any ?session= param.
 */
import { useEffect } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';

export default function TaskDetailRedirect() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const search = useSearch({ strict: false }) as { session?: string };
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    navigate({
      to: '/p/$pluginId/$',
      params: { pluginId: 'tasks', _splat: id },
      search: search.session ? { session: search.session } : {},
      replace: true,
    });
  }, [id, search.session, navigate]);

  return null;
}
