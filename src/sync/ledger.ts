export interface ContentSnapshot {
  title: string;
  description: string;
  done: boolean;
  parentTaskId: number | null;
  startDate: string | null;
  endDate: string | null;
}

export interface LedgerEntry {
  taskId: number;
  mappingKey: string;
  title: string;
  description: string;
  done: boolean;
  parentTaskId: number | null;
  startDate: string | null;
  endDate: string | null;
  contentHash: string;
  vikunjaUpdated: string;
  lastSyncedAt: string;
  /** Set when the task is missing on exactly one side. */
  unresolved?: boolean;
}

export interface LedgerStore {
  entries: Record<string, LedgerEntry>;
}

/** Remembers Vikunja creates that were not yet written into the note. */
export interface PendingLink {
  mappingKey: string;
  taskId: number;
  title: string;
  description: string;
  done: boolean;
  parentTaskId: number | null;
  vikunjaUpdated: string;
}

export function emptyLedger(): LedgerStore {
  return { entries: {} };
}

export function cloneLedger(ledger: LedgerStore): LedgerStore {
  const entries: Record<string, LedgerEntry> = {};
  for (const [key, entry] of Object.entries(ledger.entries)) {
    entries[key] = { ...entry };
  }
  return { entries };
}

/**
 * Copy mapping-scoped entries from `source` into `target`, and drop target entries
 * for that mapping that no longer exist in source (should not delete unresolved).
 * Simpler: replace all keys belonging to mappingKey prefix from source.
 */
export function commitMappingLedger(
  target: LedgerStore,
  source: LedgerStore,
  mappingKeyValue: string,
): void {
  const prefix = `${mappingKeyValue}::`;
  for (const key of Object.keys(target.entries)) {
    if (key.startsWith(prefix)) {
      delete target.entries[key];
    }
  }
  for (const [key, entry] of Object.entries(source.entries)) {
    if (key.startsWith(prefix)) {
      target.entries[key] = { ...entry };
    }
  }
}

export function mappingKey(notePath: string, projectId: number): string {
  return `${notePath}::${projectId}`;
}

export function ledgerEntryKey(mappingKeyValue: string, taskId: number): string {
  return `${mappingKeyValue}::${taskId}`;
}

import { htmlToPlainText } from './html-to-text';

export function descriptionFromLines(lines: string[]): string {
  return lines.join('\n');
}

/**
 * Split a Vikunja/Obsidian description into plain-text bullet lines.
 * HTML from Vikunja’s editor is converted to plain text first.
 */
export function descriptionToLines(description: string): string[] {
  const plain = htmlToPlainText(description ?? '');
  if (!plain) {
    return [];
  }
  return plain.split('\n').filter((line) => line.length > 0);
}

/** Canonical plain-text form used for hashing and ledger storage. */
export function normalizeDescription(description: string): string {
  return descriptionFromLines(descriptionToLines(description));
}

export function contentSnapshot(input: {
  title: string;
  description: string;
  done: boolean;
  parentTaskId: number | null;
  startDate?: string | null;
  endDate?: string | null;
}): ContentSnapshot {
  return {
    title: input.title,
    description: input.description,
    done: input.done,
    parentTaskId: input.parentTaskId,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
  };
}

/** Stable hash of synced fields for change detection. */
export function contentHash(snapshot: ContentSnapshot): string {
  const payload = [
    snapshot.title,
    snapshot.description,
    snapshot.done ? '1' : '0',
    snapshot.parentTaskId === null ? '' : String(snapshot.parentTaskId),
    snapshot.startDate ?? '',
    snapshot.endDate ?? '',
  ].join('\0');
  return fnv1aHex(payload);
}

export function snapshotFromLedger(entry: LedgerEntry): ContentSnapshot {
  return {
    title: entry.title,
    description: entry.description,
    done: entry.done,
    parentTaskId: entry.parentTaskId,
    startDate: entry.startDate ?? null,
    endDate: entry.endDate ?? null,
  };
}

export function makeLedgerEntry(input: {
  taskId: number;
  mappingKey: string;
  title: string;
  description: string;
  done: boolean;
  parentTaskId: number | null;
  startDate?: string | null;
  endDate?: string | null;
  vikunjaUpdated: string;
  lastSyncedAt?: string;
  unresolved?: boolean;
}): LedgerEntry {
  const snapshot = contentSnapshot(input);
  return {
    taskId: input.taskId,
    mappingKey: input.mappingKey,
    title: snapshot.title,
    description: snapshot.description,
    done: snapshot.done,
    parentTaskId: snapshot.parentTaskId,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    contentHash: contentHash(snapshot),
    vikunjaUpdated: input.vikunjaUpdated,
    lastSyncedAt: input.lastSyncedAt ?? new Date().toISOString(),
    unresolved: input.unresolved,
  };
}

/**
 * Normalize persisted ledger entries (fill missing date fields, recompute hash)
 * so upgrading the plugin does not mark every task as changed.
 */
export function normalizeLedgerStore(raw: LedgerStore | undefined): LedgerStore {
  if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object') {
    return emptyLedger();
  }
  const entries: Record<string, LedgerEntry> = {};
  for (const [key, value] of Object.entries(raw.entries)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const entry = value as LedgerEntry;
    entries[key] = makeLedgerEntry({
      taskId: Number(entry.taskId),
      mappingKey: String(entry.mappingKey ?? ''),
      title: String(entry.title ?? ''),
      description: String(entry.description ?? ''),
      done: Boolean(entry.done),
      parentTaskId:
        entry.parentTaskId === null || entry.parentTaskId === undefined
          ? null
          : Number(entry.parentTaskId),
      startDate: entry.startDate ?? null,
      endDate: entry.endDate ?? null,
      vikunjaUpdated: String(entry.vikunjaUpdated ?? ''),
      lastSyncedAt: String(entry.lastSyncedAt ?? new Date().toISOString()),
      unresolved: entry.unresolved,
    });
  }
  return { entries };
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
