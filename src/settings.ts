export type ConflictPolicy = 'prefer-obsidian' | 'prefer-vikunja';
export type SyncIntervalUnit = 'minutes' | 'hours';

export interface NoteProjectMapping {
  notePath: string;
  projectId: number;
}

export interface PluginSettings {
  vikunjaBaseUrl: string;
  vikunjaApiToken: string;
  mappings: NoteProjectMapping[];
  conflictPolicy: ConflictPolicy;
  syncOnStartup: boolean;
  syncIntervalEnabled: boolean;
  syncIntervalValue: number;
  syncIntervalUnit: SyncIntervalUnit;
  syncOnFileChange: boolean;
  /** When true, Sync now previews actions without writing notes or Vikunja. */
  dryRunDefault: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  vikunjaBaseUrl: '',
  vikunjaApiToken: '',
  mappings: [],
  conflictPolicy: 'prefer-obsidian',
  syncOnStartup: false,
  syncIntervalEnabled: false,
  syncIntervalValue: 15,
  syncIntervalUnit: 'minutes',
  syncOnFileChange: false,
  dryRunDefault: false,
};

/** Minimum allowed interval in minutes (architecture: at least 1 minute). */
export const MIN_SYNC_INTERVAL_MINUTES = 1;

export function normalizeSyncIntervalValue(value: number): number {
  if (!Number.isFinite(value) || value < MIN_SYNC_INTERVAL_MINUTES) {
    return MIN_SYNC_INTERVAL_MINUTES;
  }
  return Math.floor(value);
}

export function syncIntervalToMilliseconds(
  value: number,
  unit: SyncIntervalUnit,
): number {
  const normalized = normalizeSyncIntervalValue(value);
  const minutes = unit === 'hours' ? normalized * 60 : normalized;
  return minutes * 60 * 1000;
}

export function createEmptyMapping(): NoteProjectMapping {
  return {
    notePath: '',
    projectId: 0,
  };
}

/** Normalize a vault-relative note path from settings. */
export function normalizeMappingPath(path: string): string {
  return path.trim().replace(/^\/+/, '');
}
