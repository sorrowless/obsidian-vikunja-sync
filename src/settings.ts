export type ConflictPolicy = 'prefer-obsidian' | 'prefer-vikunja';
export type SyncIntervalUnit = 'minutes' | 'hours';

export interface NoteProjectMapping {
  notePath: string;
  projectId: number;
}

/** Maps a Vikunja user (assignee) to a single Obsidian `#tag`. */
export interface AssigneeMapping {
  vikunjaUserId: number;
  /** Display-only label (username / name). */
  label: string;
  /** Obsidian tag without leading `#`, e.g. `alice`. */
  obsidianTag: string;
}

export interface PluginSettings {
  vikunjaBaseUrl: string;
  vikunjaApiToken: string;
  mappings: NoteProjectMapping[];
  assigneeMappings: AssigneeMapping[];
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
  assigneeMappings: [],
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

export function createEmptyAssigneeMapping(): AssigneeMapping {
  return {
    vikunjaUserId: 0,
    label: '',
    obsidianTag: '',
  };
}

/** Strip leading `#`, trim, NFC-normalize. Case is preserved as typed. */
export function normalizeObsidianTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').normalize('NFC');
}

export function isAssigneeMappingBlank(mapping: AssigneeMapping): boolean {
  return !(mapping.vikunjaUserId > 0) && normalizeObsidianTag(mapping.obsidianTag).length === 0;
}

export function isAssigneeMappingComplete(mapping: AssigneeMapping): boolean {
  return mapping.vikunjaUserId > 0 && normalizeObsidianTag(mapping.obsidianTag).length > 0;
}

/**
 * Normalize assignee mapping fields in place (same identity rules as note mappings).
 */
export function prepareAssigneeMappingsForSave(mappings: AssigneeMapping[]): void {
  for (const mapping of mappings) {
    mapping.label = mapping.label.trim().normalize('NFC');
    mapping.obsidianTag = normalizeObsidianTag(mapping.obsidianTag);
    if (!Number.isFinite(mapping.vikunjaUserId) || mapping.vikunjaUserId < 0) {
      mapping.vikunjaUserId = 0;
    } else {
      mapping.vikunjaUserId = Math.floor(mapping.vikunjaUserId);
    }
  }
}

/** Case-insensitive tag lookup against configured assignee mappings. */
export function findAssigneeMappingByTag(
  mappings: readonly AssigneeMapping[],
  tag: string,
): AssigneeMapping | null {
  const needle = normalizeObsidianTag(tag).toLowerCase();
  if (!needle) {
    return null;
  }
  for (const mapping of mappings) {
    if (normalizeObsidianTag(mapping.obsidianTag).toLowerCase() === needle) {
      return mapping;
    }
  }
  return null;
}

export function findAssigneeMappingByUserId(
  mappings: readonly AssigneeMapping[],
  userId: number,
): AssigneeMapping | null {
  if (!(userId > 0)) {
    return null;
  }
  for (const mapping of mappings) {
    if (mapping.vikunjaUserId === userId) {
      return mapping;
    }
  }
  return null;
}

/**
 * Suggest an Obsidian tag from a Vikunja username (lowercase, safe chars).
 */
export function suggestObsidianTagFromUsername(username: string): string {
  return normalizeObsidianTag(username)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_/-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
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
