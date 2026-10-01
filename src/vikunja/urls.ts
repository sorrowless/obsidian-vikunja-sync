/** Normalized Vikunja instance root without trailing slash. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** API root including `/api/v1`. */
export function apiRoot(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/v1`;
}

/** Frontend task URL written into Obsidian notes. */
export function taskPageUrl(baseUrl: string, taskId: number): string {
  return `${normalizeBaseUrl(baseUrl)}/tasks/${taskId}`;
}

/**
 * Extract a Vikunja task id from a URL if it belongs to this instance.
 * Ignores trailing slashes and query/hash fragments.
 */
export function extractTaskIdFromUrl(url: string, baseUrl: string): number | null {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!normalizedBase || !url.trim()) {
    return null;
  }

  let parsed: URL;
  let expected: URL;
  try {
    parsed = new URL(url.trim());
    expected = new URL(normalizedBase);
  } catch {
    return null;
  }

  if (parsed.origin !== expected.origin) {
    return null;
  }

  const basePath = expected.pathname.replace(/\/+$/, '');
  const path = parsed.pathname.replace(/\/+$/, '');
  const prefix = `${basePath}/tasks/`;

  if (path.startsWith(prefix)) {
    const rest = path.slice(prefix.length);
    if (/^\d+$/.test(rest)) {
      return Number.parseInt(rest, 10);
    }
    return null;
  }

  // Base URL with no path prefix: `/tasks/{id}`
  if (basePath === '' || basePath === '/') {
    const match = path.match(/^\/tasks\/(\d+)$/);
    return match?.[1] ? Number.parseInt(match[1], 10) : null;
  }

  return null;
}

/** Parse a line body that is exactly `[title](url)`. */
export function parseMarkdownLink(text: string): { title: string; url: string } | null {
  const match = text.trim().match(/^\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
  if (!match) {
    return null;
  }
  return { title: match[1] ?? '', url: match[2] ?? '' };
}
