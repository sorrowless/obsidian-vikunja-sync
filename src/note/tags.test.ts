import { describe, expect, it } from 'vitest';
import { formatTaskTagsSuffix, parseTaskTags, tagsForWrite } from './tags';

describe('parseTaskTags', () => {
  it('extracts tags and leaves remainder', () => {
    const parsed = parseTaskTags('Call dentist #alice #focus');
    expect(parsed.tags).toEqual(['alice', 'focus']);
    expect(parsed.remainder).toBe('Call dentist');
  });

  it('preserves tag case and NFC-normalizes', () => {
    const parsed = parseTaskTags('#Alice #Cafe\u0301');
    expect(parsed.tags).toEqual(['Alice', 'Café'.normalize('NFC')]);
  });
});


describe('formatTaskTagsSuffix', () => {
  it('formats tags with a leading space', () => {
    expect(formatTaskTagsSuffix(['alice', 'focus'])).toBe(' #alice #focus');
    expect(formatTaskTagsSuffix([])).toBe('');
  });
});

describe('tagsForWrite', () => {
  it('keeps unmapped tags and replaces mapped assignee tags', () => {
    const mapped = new Set(['alice', 'bob']);
    expect(tagsForWrite(['focus', 'Alice', 'urgent'], mapped, 'bob')).toEqual([
      'focus',
      'urgent',
      'bob',
    ]);
  });

  it('drops mapped tags when assignee is cleared', () => {
    const mapped = new Set(['alice']);
    expect(tagsForWrite(['alice', 'focus'], mapped, null)).toEqual(['focus']);
  });
});
