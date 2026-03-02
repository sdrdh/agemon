/**
 * Convert a title string into a URL-safe slug.
 * Lowercase, replace non-alphanumeric with hyphens, collapse runs, trim edges.
 */
export function slugify(title: string, maxLen = 60): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

  if (slug.length > maxLen) {
    // Truncate on word boundary (last hyphen before maxLen)
    slug = slug.slice(0, maxLen);
    const lastHyphen = slug.lastIndexOf('-');
    if (lastHyphen > 0) slug = slug.slice(0, lastHyphen);
  }

  return slug || 'task';
}
