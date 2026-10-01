import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  createEmptyMapping,
  isMappingBlank,
  isMappingComplete,
  normalizeMappingPath,
  normalizeSyncIntervalValue,
  prepareMappingsForSave,
  syncIntervalToMilliseconds,
} from './settings';

describe('DEFAULT_SETTINGS', () => {
  it('prefers Obsidian on conflicts and disables automatic triggers', () => {
    expect(DEFAULT_SETTINGS.conflictPolicy).toBe('prefer-obsidian');
    expect(DEFAULT_SETTINGS.syncOnStartup).toBe(false);
    expect(DEFAULT_SETTINGS.syncIntervalEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.syncOnFileChange).toBe(false);
    expect(DEFAULT_SETTINGS.mappings).toEqual([]);
  });
});

describe('normalizeSyncIntervalValue', () => {
  it('enforces a minimum of 1', () => {
    expect(normalizeSyncIntervalValue(0)).toBe(1);
    expect(normalizeSyncIntervalValue(-3)).toBe(1);
    expect(normalizeSyncIntervalValue(Number.NaN)).toBe(1);
    expect(normalizeSyncIntervalValue(2.9)).toBe(2);
  });
});

describe('syncIntervalToMilliseconds', () => {
  it('converts minutes and hours', () => {
    expect(syncIntervalToMilliseconds(1, 'minutes')).toBe(60_000);
    expect(syncIntervalToMilliseconds(2, 'hours')).toBe(7_200_000);
  });
});

describe('mapping path helpers', () => {
  it('keeps spaces inside file names and only trims edges / leading slashes', () => {
    expect(normalizeMappingPath('  Folder/My tasks.md  ')).toBe('Folder/My tasks.md');
    expect(normalizeMappingPath('/Inbox/Weekly note.md')).toBe('Inbox/Weekly note.md');
  });

  it('detects blank and complete mappings', () => {
    expect(isMappingBlank(createEmptyMapping())).toBe(true);
    expect(isMappingComplete({ notePath: 'Folder/My tasks.md', projectId: 3 })).toBe(true);
    expect(isMappingComplete({ notePath: 'Folder/My tasks.md', projectId: 0 })).toBe(false);
  });

  it('normalizes mappings in place without replacing object identity', () => {
    const mapping = { notePath: '  Folder/My tasks.md  ', projectId: 3.9 };
    const mappings = [mapping];
    prepareMappingsForSave(mappings);
    expect(mappings[0]).toBe(mapping);
    expect(mapping.notePath).toBe('Folder/My tasks.md');
    expect(mapping.projectId).toBe(3);
  });
});
