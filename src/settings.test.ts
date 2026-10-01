import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  normalizeSyncIntervalValue,
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
