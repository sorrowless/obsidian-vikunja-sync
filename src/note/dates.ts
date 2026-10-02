/** Obsidian Tasks–style start marker → Vikunja `start_date`. */
export const START_DATE_EMOJI = '🛫';
/** End marker → Vikunja `end_date` (Obsidian Tasks due-date emoji, mapped to end here). */
export const END_DATE_EMOJI = '📅';

/** Vikunja’s conventional “unset” datetime. */
export const VIKUNJA_UNSET_DATE = '0001-01-01T00:00:00Z';

const DATE_VALUE =
  '\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?';

const DATE_TOKEN_RE = new RegExp(
  `(?:^|\\s)(${START_DATE_EMOJI}|${END_DATE_EMOJI})\\s+(${DATE_VALUE})`,
  'gu',
);

export interface ParsedTaskDates {
  /** ISO-8601 UTC, or null when unset. */
  startDate: string | null;
  /** ISO-8601 UTC, or null when unset. */
  endDate: string | null;
  /** Body text with date tokens removed. */
  remainder: string;
}

/**
 * Extract start/end date tokens from a task-line body (or trailing suffix).
 * Title text is whatever remains after removing the emoji date tokens.
 */
export function parseTaskDates(text: string): ParsedTaskDates {
  let startDate: string | null = null;
  let endDate: string | null = null;
  const remainder = text
    .replace(DATE_TOKEN_RE, (_, emoji: string, value: string) => {
      const iso = parseFlexibleDate(value);
      if (iso) {
        if (emoji === START_DATE_EMOJI) {
          startDate = iso;
        } else if (emoji === END_DATE_EMOJI) {
          endDate = iso;
        }
      }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  return { startDate, endDate, remainder };
}

/** Format a trailing suffix for the note line (leading space when non-empty). */
export function formatTaskDatesSuffix(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string {
  const parts: string[] = [];
  if (startDate) {
    parts.push(`${START_DATE_EMOJI} ${formatDateForNote(startDate)}`);
  }
  if (endDate) {
    parts.push(`${END_DATE_EMOJI} ${formatDateForNote(endDate)}`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/** Normalize a Vikunja API date string to ISO UTC, or null when unset. */
export function normalizeVikunjaDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  if (isUnsetVikunjaDate(trimmed)) {
    return null;
  }
  return parseFlexibleDate(trimmed);
}

export function isUnsetVikunjaDate(value: string): boolean {
  if (!value) {
    return true;
  }
  // Vikunja zero-time variants
  return (
    value.startsWith('0001-01-01') ||
    value.startsWith('0000-00-00') ||
    value === VIKUNJA_UNSET_DATE
  );
}

/** Value to send to Vikunja (unset → conventional zero time). */
export function toVikunjaDatePayload(iso: string | null | undefined): string {
  return iso && !isUnsetVikunjaDate(iso) ? iso : VIKUNJA_UNSET_DATE;
}

/**
 * Parse a flexible date/time into ISO UTC.
 * Naive values (no timezone) are interpreted in the local timezone.
 */
export function parseFlexibleDate(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  );
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = match[4] !== undefined ? Number(match[4]) : 0;
  const minute = match[5] !== undefined ? Number(match[5]) : 0;
  const second = match[6] !== undefined ? Number(match[6]) : 0;
  const tz = match[7];

  if (tz) {
    const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  const local = new Date(year, month, day, hour, minute, second);
  if (
    Number.isNaN(local.getTime()) ||
    local.getFullYear() !== year ||
    local.getMonth() !== month ||
    local.getDate() !== day
  ) {
    return null;
  }
  return local.toISOString();
}

/** Human-facing note form: `YYYY-MM-DD` or `YYYY-MM-DD HH:mm` in local time. */
export function formatDateForNote(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return iso;
  }
  const yyyy = String(dt.getFullYear());
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hour = dt.getHours();
  const minute = dt.getMinutes();
  const second = dt.getSeconds();
  if (hour === 0 && minute === 0 && second === 0) {
    return `${yyyy}-${mm}-${dd}`;
  }
  return `${yyyy}-${mm}-${dd} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
