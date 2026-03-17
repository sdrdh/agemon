import { marked } from 'marked';
import type { MemoryFile } from './index.ts';

function layout(title: string, breadcrumbs: { label: string; href?: string }[], body: string): string {
  const crumbs = breadcrumbs.map((b, i) => {
    const isLast = i === breadcrumbs.length - 1;
    if (isLast || !b.href) return `<span>${esc(b.label)}</span>`;
    return `<a href="${b.href}">${esc(b.label)}</a>`;
  }).join(' <span style="opacity:0.4">/</span> ');

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} — Agemon</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
  <style>
    :root { --pico-font-size: 15px; }
    body { padding: 0; }
    .container { max-width: 720px; padding: 1.5rem 1rem; }
    nav.breadcrumb { margin-bottom: 1.5rem; font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    nav.breadcrumb a { color: var(--pico-muted-color); text-decoration: none; }
    nav.breadcrumb a:hover { color: var(--pico-primary); text-decoration: underline; }
    nav.breadcrumb span { color: var(--pico-color); }
    .file-list { list-style: none; padding: 0; }
    .file-list li { margin-bottom: 0.5rem; }
    .file-list a {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1rem; border-radius: 0.5rem;
      background: var(--pico-card-background-color);
      border: 1px solid var(--pico-muted-border-color);
      text-decoration: none; color: inherit;
      transition: border-color 0.15s;
    }
    .file-list a:hover { border-color: var(--pico-primary); }
    .file-name { font-weight: 500; }
    .file-type { font-size: 0.8rem; color: var(--pico-muted-color); }
    .section-label { font-size: 0.9rem; font-weight: 600; color: var(--pico-muted-color); margin-bottom: 0.75rem; }
    section { margin-bottom: 2rem; }
  </style>
</head>
<body>
  <main class="container">
    <nav class="breadcrumb">${crumbs}</nav>
    ${body}
  </main>
</body>
</html>`;
}

/** GET / — all tasks grouped by type */
export function renderTaskList(files: MemoryFile[]): string {
  let body = '<h1>Task Files</h1>';

  if (files.length === 0) {
    body += '<p><em>No memory or summary files found in any task directory.</em></p>';
    return layout('Task Files', [{ label: 'Memory CMS' }], body);
  }

  const memories = files.filter(f => f.type === 'memory');
  const summaries = files.filter(f => f.type === 'summary');

  if (memories.length > 0) {
    body += '<section>';
    body += '<p class="section-label">Memories</p>';
    body += '<ul class="file-list">';
    for (const f of memories) {
      body += `<li>
        <a href="/p/memory-cms/tasks/${f.taskId}/${f.filename}">
          <span class="file-name">${esc(f.taskId)}</span>
          <span class="file-type">${esc(f.filename)}</span>
        </a>
      </li>`;
    }
    body += '</ul></section>';
  }

  if (summaries.length > 0) {
    body += '<section>';
    body += '<p class="section-label">Summaries</p>';
    body += '<ul class="file-list">';
    for (const f of summaries) {
      body += `<li>
        <a href="/p/memory-cms/tasks/${f.taskId}/${f.filename}">
          <span class="file-name">${esc(f.taskId)}</span>
          <span class="file-type">${esc(f.filename)}</span>
        </a>
      </li>`;
    }
    body += '</ul></section>';
  }

  return layout('Task Files', [{ label: 'Memory CMS' }], body);
}

/** GET /tasks/:taskId — list files for a task */
export function renderTaskFiles(taskId: string, files: MemoryFile[]): string {
  let body = `<h1>${esc(taskId)}</h1>`;

  body += '<ul class="file-list">';
  for (const f of files) {
    body += `<li>
      <a href="/p/memory-cms/tasks/${f.taskId}/${f.filename}">
        <span class="file-name">${esc(f.filename)}</span>
        <span class="file-type">${esc(f.type)}</span>
      </a>
    </li>`;
  }
  body += '</ul>';

  return layout(taskId, [
    { label: 'Memory CMS', href: '/p/memory-cms' },
    { label: taskId },
  ], body);
}

/** GET /tasks/:taskId/:filename — render a specific file */
export function renderFile(taskId: string, filename: string, content: string): string {
  const body = `<h1>${esc(filename)}</h1><article>${marked.parse(content)}</article>`;

  return layout(`${taskId} / ${filename}`, [
    { label: 'Memory CMS', href: '/p/memory-cms' },
    { label: taskId, href: `/p/memory-cms/tasks/${taskId}` },
    { label: filename },
  ], body);
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
