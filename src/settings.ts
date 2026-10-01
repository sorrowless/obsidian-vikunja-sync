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

/** Normalize a vault-relative note path from settings. Spaces in names are kept. */
export function normalizeMappingPath(path: string): string {
  // NFC avoids macOS NFD filename mismatches with Cyrillic typed in settings.
  return path.trim().replace(/^\/+/, '').normalize('NFC');
}

export function isMappingComplete(mapping: NoteProjectMapping): boolean {
  return normalizeMappingPath(mapping.notePath).length > 0 && mapping.projectId > 0;
}

/** True when the row is still the blank draft created by “Add mapping”. */
export function isMappingBlank(mapping: NoteProjectMapping): boolean {
  return normalizeMappingPath(mapping.notePath).length === 0 && !(mapping.projectId > 0);
}

/**
 * Normalize mapping fields in place.
 * Important: do not replace mapping objects or the mappings array — the settings
 * tab keeps closures/indexes into these objects across keystrokes.
 */
export function prepareMappingsForSave(mappings: NoteProjectMapping[]): void {
  for (const mapping of mappings) {
    mapping.notePath = normalizeMappingPath(mapping.notePath);
    if (!Number.isFinite(mapping.projectId) || mapping.projectId < 0) {
      mapping.projectId = 0;
    } else {
      mapping.projectId = Math.floor(mapping.projectId);
    }
  }
}
