import { describe, expect, it } from 'vitest';
import {
  END_DATE_EMOJI,
  START_DATE_EMOJI,
  formatTaskDatesSuffix,
  normalizeVikunjaDate,
  parseFlexibleDate,
  parseTaskDates,
  toVikunjaDatePayload,
  VIKUNJA_UNSET_DATE,
} from './dates';

describe('parseTaskDates', () => {
  it('extracts start and end tokens and leaves the title', () => {
    const parsed = parseTaskDates(
      `Buy milk ${START_DATE_EMOJI} 2026-10-02 10:00 ${END_DATE_EMOJI} 2026-10-02 12:00`,
    );
    expect(parsed.remainder).toBe('Buy milk');
    expect(parsed.startDate).toBe(parseFlexibleDate('2026-10-02 10:00'));
    expect(parsed.endDate).toBe(parseFlexibleDate('2026-10-02 12:00'));
  });

  it('accepts tokens in either order', () => {
    const parsed = parseTaskDates(
      `Task ${END_DATE_EMOJI} 2026-10-03 ${START_DATE_EMOJI} 2026-10-01`,
    );
    expect(parsed.remainder).toBe('Task');
    expect(parsed.startDate).toBe(parseFlexibleDate('2026-10-01'));
    expect(parsed.endDate).toBe(parseFlexibleDate('2026-10-03'));
  });
});

describe('formatTaskDatesSuffix', () => {
  it('formats both markers with a leading space', () => {
    const start = parseFlexibleDate('2026-10-02 10:00');
    const end = parseFlexibleDate('2026-10-02 12:00');
    expect(formatTaskDatesSuffix(start, end)).toBe(
      ` ${START_DATE_EMOJI} 2026-10-02 10:00 ${END_DATE_EMOJI} 2026-10-02 12:00`,
    );
  });

  it('returns empty string when both unset', () => {
    expect(formatTaskDatesSuffix(null, null)).toBe('');
  });
});

describe('vikunja date helpers', () => {
  it('treats zero-time as unset', () => {
    expect(normalizeVikunjaDate(VIKUNJA_UNSET_DATE)).toBeNull();
    expect(normalizeVikunjaDate('0001-01-01T00:00:00Z')).toBeNull();
    expect(toVikunjaDatePayload(null)).toBe(VIKUNJA_UNSET_DATE);
  });
});
