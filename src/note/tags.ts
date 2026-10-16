import { normalizeObsidianTag } from '../settings';

/** Match `#tag` or `#path/tag` tokens (Obsidian-style). */
const TAG_TOKEN_RE = /(?:^|\s)#([^\s#]+)/gu;

export interface ParsedTaskTags {
  /** Tag names without leading `#`, in appearance order. */
  tags: string[];
  /** Body text with tag tokens removed. */
  remainder: string;
}

/**
 * Extract `#tag` tokens from a task-line body (or trailing suffix after the link).
 */
export function parseTaskTags(text: string): ParsedTaskTags {
  const tags: string[] = [];
  const remainder = text
    .replace(TAG_TOKEN_RE, (_, raw: string) => {
      const tag = normalizeObsidianTag(raw);
      if (tag) {
        tags.push(tag);
      }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  return { tags, remainder };
}

/** Format trailing tags (leading space when non-empty). */
export function formatTaskTagsSuffix(tags: readonly string[]): string {
  const parts = tags
    .map((tag) => normalizeObsidianTag(tag))
    .filter((tag) => tag.length > 0)
    .map((tag) => `#${tag}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * Build the tag list to write: keep unmapped tags, drop mapped assignee tags,
 * then append the current assignee tag (if any).
 */
export function tagsForWrite(
  existingTags: readonly string[],
  mappedTagNames: ReadonlySet<string>,
  assigneeTag: string | null,
): string[] {
  const mappedLower = new Set([...mappedTagNames].map((t) => t.toLowerCase()));
  const kept: string[] = [];
  const seen = new Set<string>();

  for (const tag of existingTags) {
    const normalized = normalizeObsidianTag(tag);
    const key = normalized.toLowerCase();
    if (!normalized || mappedLower.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(normalized);
  }

  if (assigneeTag) {
    const normalized = normalizeObsidianTag(assigneeTag);
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      kept.push(normalized);
    }
  }

  return kept;
}
