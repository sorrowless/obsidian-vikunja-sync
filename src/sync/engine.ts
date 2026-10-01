import { parseNoteTasks } from '../note/parser';
import type { ParsedTaskNode } from '../note/types';
import type { ConflictPolicy } from '../settings';
import type { VikunjaClient } from '../vikunja/client';
import type { VikunjaTask } from '../vikunja/types';
import {
  cloneLedger,
  commitMappingLedger,
  contentHash,
  contentSnapshot,
  descriptionFromLines,
  descriptionToLines,
  ledgerEntryKey,
  makeLedgerEntry,
  mappingKey,
  normalizeDescription,
  type LedgerEntry,
  type LedgerStore,
  type PendingLink,
} from './ledger';
import { indexRemoteTasks } from './remote';
import {
  applyRootReplacements,
  checkboxCharForDone,
  renderTask,
  type RenderableTask,
} from './writer';

export interface SyncMapping {
  notePath: string;
  projectId: number;
}

export interface SyncEngineOptions {
  baseUrl: string;
  conflictPolicy: ConflictPolicy;
  client: VikunjaClient;
  readNote: (path: string) => Promise<string>;
  writeNote: (path: string, content: string) => Promise<void>;
  /** When true, list remotes but do not mutate Vikunja, notes, or the real ledger. */
  dryRun?: boolean;
  now?: () => string;
}

export interface MappingSyncCounts {
  createdRemote: number;
  createdLocal: number;
  pushed: number;
  pulled: number;
  conflictsResolved: number;
  unchanged: number;
  unresolvedRemovals: number;
  recoveredPendingLinks: number;
}

export interface MappingSyncResult {
  notePath: string;
  projectId: number;
  counts: MappingSyncCounts;
  errors: string[];
  unresolvedTaskIds: number[];
  /** Creates that reached Vikunja but could not be written into the note. */
  pendingLinks: PendingLink[];
}

export interface SyncRunResult {
  mappings: MappingSyncResult[];
  message: string;
  dryRun: boolean;
}

interface MutableTask {
  lineIndex: number | null;
  endLineIndex: number | null;
  indent: string;
  listMarker: string;
  checkboxChar: string;
  done: boolean | null;
  title: string;
  descriptionLines: string[];
  vikunjaTaskId: number | null;
  children: MutableTask[];
  parent: MutableTask | null;
  isNew: boolean;
  dirty: boolean;
}

export async function syncAllMappings(
  mappings: SyncMapping[],
  ledger: LedgerStore,
  pendingLinks: PendingLink[],
  options: SyncEngineOptions,
): Promise<SyncRunResult> {
  const results: MappingSyncResult[] = [];
  const dryRun = options.dryRun === true;
  const nextPending = [...pendingLinks];

  for (const mapping of mappings) {
    const notePath = normalizeNotePath(mapping.notePath);
    const projectId = mapping.projectId;

    if (!notePath && !(projectId > 0)) {
      // Blank draft row from “Add mapping” — ignore.
      continue;
    }

    if (!notePath || projectId <= 0) {
      results.push({
        notePath,
        projectId,
        counts: emptyCounts(),
        errors: [
          !notePath && projectId > 0
            ? `Mapping is incomplete: note path is missing (project id ${projectId})`
            : `Mapping is incomplete: project id is missing (note path "${notePath}")`,
        ],
        unresolvedTaskIds: [],
        pendingLinks: [],
      });
      continue;
    }

    try {
      const result = await syncOneMapping(
        { notePath, projectId },
        ledger,
        nextPending,
        { ...options, dryRun },
      );
      results.push(result);

      // Replace pending links for this mapping with whatever the run produced.
      const key = mappingKey(notePath, projectId);
      for (let i = nextPending.length - 1; i >= 0; i -= 1) {
        if (nextPending[i]?.mappingKey === key) {
          nextPending.splice(i, 1);
        }
      }
      if (!dryRun) {
        nextPending.push(...result.pendingLinks);
      }
    } catch (error) {
      results.push({
        notePath,
        projectId,
        counts: emptyCounts(),
        errors: [errorMessage(error)],
        unresolvedTaskIds: [],
        pendingLinks: [],
      });
    }
  }

  // Mutate caller's pendingLinks array to the new set.
  pendingLinks.splice(0, pendingLinks.length, ...nextPending);

  const errorCount = results.reduce((sum, item) => sum + item.errors.length, 0);
  const totals = results.reduce((acc, item) => addCounts(acc, item.counts), emptyCounts());

  return {
    mappings: results,
    dryRun,
    message: summarizeRun(totals, errorCount, mappings.length, dryRun),
  };
}

async function syncOneMapping(
  mapping: SyncMapping,
  ledger: LedgerStore,
  pendingLinks: PendingLink[],
  options: SyncEngineOptions,
): Promise<MappingSyncResult> {
  const counts = emptyCounts();
  const errors: string[] = [];
  const unresolvedIds: number[] = [];
  const createdPending: PendingLink[] = [];
  const now = options.now ?? (() => new Date().toISOString());
  const dryRun = options.dryRun === true;
  const key = mappingKey(mapping.notePath, mapping.projectId);
  const workingLedger = cloneLedger(ledger);

  const markdown = await options.readNote(mapping.notePath);
  const parsed = parseNoteTasks(markdown, { vikunjaBaseUrl: options.baseUrl });
  const roots = parsed.map((node) => fromParsed(node, null));

  const remoteMap = indexRemoteTasks(await options.client.listProjectTasks(mapping.projectId));

  const localById = new Map<number, MutableTask>();
  const localOrder: MutableTask[] = [];
  walkMutable(roots, (task) => {
    localOrder.push(task);
    if (task.vikunjaTaskId !== null) {
      localById.set(task.vikunjaTaskId, task);
    }
  });

  const mappingPending = pendingLinks.filter((item) => item.mappingKey === key);

  for (const local of localOrder) {
    const parentId = local.parent?.vikunjaTaskId ?? null;

    if (local.vikunjaTaskId === null) {
      const recovered = takePendingMatch(mappingPending, local.title, parentId);
      if (recovered) {
        local.vikunjaTaskId = recovered.taskId;
        local.dirty = true;
        markRootDirty(local);
        localById.set(recovered.taskId, local);
        writeLedger(workingLedger, key, {
          id: recovered.taskId,
          title: local.title,
          description: descriptionFromLines(local.descriptionLines),
          done: local.done ?? recovered.done,
          updated: recovered.vikunjaUpdated,
        }, parentId, now);
        counts.recoveredPendingLinks += 1;
        counts.createdRemote += 1;
        continue;
      }

      try {
        const created = dryRun
          ? fakeCreatedTask(local, mapping.projectId, now)
          : await options.client.createTask(mapping.projectId, {
              title: local.title,
              description: descriptionFromLines(local.descriptionLines),
              done: local.done ?? false,
            });
        if (parentId !== null && !dryRun) {
          await ensureSubtaskRelation(options.client, created.id, parentId);
        }
        local.vikunjaTaskId = created.id;
        local.dirty = true;
        markRootDirty(local);
        localById.set(created.id, local);
        writeLedger(workingLedger, key, created, parentId, now);
        createdPending.push({
          mappingKey: key,
          taskId: created.id,
          title: local.title,
          description: descriptionFromLines(local.descriptionLines),
          done: local.done ?? false,
          parentTaskId: parentId,
          vikunjaUpdated: created.updated || now(),
        });
        counts.createdRemote += 1;
      } catch (error) {
        errors.push(`Create remote "${local.title}": ${errorMessage(error)}`);
      }
      continue;
    }

    const taskId = local.vikunjaTaskId;
    const remote = remoteMap.get(taskId);
    const entry = workingLedger.entries[ledgerEntryKey(key, taskId)];

    if (!remote) {
      if (entry) {
        entry.unresolved = true;
        unresolvedIds.push(taskId);
        counts.unresolvedRemovals += 1;
      } else {
        errors.push(`Linked task #${taskId} is missing in Vikunja and has no ledger entry`);
      }
      continue;
    }

    const localSnap = localSnapshot(local, parentId, entry);
    const remoteSnap = remoteSnapshot(remote.task, remote.parentTaskId);
    const localHash = contentHash(localSnap);
    const remoteHash = contentHash(remoteSnap);

    if (!entry) {
      if (localHash === remoteHash) {
        writeLedger(workingLedger, key, remote.task, remote.parentTaskId, now);
        counts.unchanged += 1;
      } else if (options.conflictPolicy === 'prefer-obsidian') {
        await pushLocal(
          options,
          local,
          remote.task,
          parentId,
          remote.parentTaskId,
          key,
          workingLedger,
          now,
          counts,
          errors,
          true,
          dryRun,
        );
      } else {
        pullRemote(local, remote.task, remote.parentTaskId, key, workingLedger, now, counts, true);
      }
      continue;
    }

    const localChanged = localHash !== entry.contentHash;
    const remoteChanged =
      remoteHash !== entry.contentHash || remote.task.updated !== entry.vikunjaUpdated;

    if (!localChanged && !remoteChanged) {
      entry.unresolved = false;
      counts.unchanged += 1;
      continue;
    }

    if (localChanged && !remoteChanged) {
      await pushLocal(
        options,
        local,
        remote.task,
        parentId,
        remote.parentTaskId,
        key,
        workingLedger,
        now,
        counts,
        errors,
        false,
        dryRun,
      );
      continue;
    }

    if (!localChanged && remoteChanged) {
      pullRemote(local, remote.task, remote.parentTaskId, key, workingLedger, now, counts, false);
      continue;
    }

    if (options.conflictPolicy === 'prefer-obsidian') {
      await pushLocal(
        options,
        local,
        remote.task,
        parentId,
        remote.parentTaskId,
        key,
        workingLedger,
        now,
        counts,
        errors,
        true,
        dryRun,
      );
    } else {
      pullRemote(local, remote.task, remote.parentTaskId, key, workingLedger, now, counts, true);
    }
  }

  const remotes = [...remoteMap.values()].sort((a, b) => {
    if (a.parentTaskId === null && b.parentTaskId !== null) return -1;
    if (a.parentTaskId !== null && b.parentTaskId === null) return 1;
    return a.task.id - b.task.id;
  });

  for (const remote of remotes) {
    if (localById.has(remote.task.id)) {
      continue;
    }
    const entry = workingLedger.entries[ledgerEntryKey(key, remote.task.id)];
    if (entry) {
      entry.unresolved = true;
      unresolvedIds.push(remote.task.id);
      counts.unresolvedRemovals += 1;
      continue;
    }

    const created = createLocalNode(remote.task);
    const parentLocal =
      remote.parentTaskId !== null ? localById.get(remote.parentTaskId) ?? null : null;
    if (parentLocal) {
      created.indent = `${parentLocal.indent}    `;
      created.parent = parentLocal;
      parentLocal.children.push(created);
      markRootDirty(parentLocal);
    } else {
      created.isNew = true;
      roots.push(created);
    }
    localById.set(remote.task.id, created);
    writeLedger(workingLedger, key, remote.task, remote.parentTaskId, now);
    counts.createdLocal += 1;
  }

  const nextMarkdown = writeMarkdown(markdown, roots, options.baseUrl);
  const noteChanged = nextMarkdown !== markdown;

  if (noteChanged) {
    if (dryRun) {
      // Preview only — do not write the note or commit the ledger.
      return {
        notePath: mapping.notePath,
        projectId: mapping.projectId,
        counts,
        errors,
        unresolvedTaskIds: unresolvedIds,
        pendingLinks: [],
      };
    }

    try {
      await options.writeNote(mapping.notePath, nextMarkdown);
    } catch (error) {
      errors.push(`Write note failed: ${errorMessage(error)}`);
      // Keep pending links for creates so the next run can attach ids instead of duplicating.
      return {
        notePath: mapping.notePath,
        projectId: mapping.projectId,
        counts: {
          ...counts,
          // Note was not updated; do not claim local creates landed in the file.
          createdLocal: 0,
        },
        errors,
        unresolvedTaskIds: unresolvedIds,
        pendingLinks: createdPending,
      };
    }
  }

  if (!dryRun) {
    commitMappingLedger(ledger, workingLedger, key);
  }

  return {
    notePath: mapping.notePath,
    projectId: mapping.projectId,
    counts,
    errors,
    unresolvedTaskIds: unresolvedIds,
    // Note write succeeded (or no write needed) — pending creates are resolved.
    pendingLinks: [],
  };
}

async function pushLocal(
  options: SyncEngineOptions,
  local: MutableTask,
  remote: VikunjaTask,
  parentId: number | null,
  currentParentId: number | null,
  key: string,
  ledger: LedgerStore,
  now: () => string,
  counts: MappingSyncCounts,
  errors: string[],
  isConflict: boolean,
  dryRun: boolean,
): Promise<void> {
  try {
    const update: { title: string; description: string; done?: boolean } = {
      title: local.title,
      description: descriptionFromLines(local.descriptionLines),
    };
    if (local.done !== null) {
      update.done = local.done;
    }

    const updated = dryRun
      ? {
          ...remote,
          title: update.title,
          description: update.description,
          done: update.done ?? remote.done,
          updated: now(),
        }
      : await options.client.updateTask(remote.id, update);

    if (!dryRun) {
      await syncParentRelation(options.client, remote.id, parentId, currentParentId);
    }

    writeLedger(
      ledger,
      key,
      {
        id: updated.id,
        title: local.title,
        description: update.description,
        done: update.done ?? remote.done,
        updated: updated.updated || now(),
      },
      parentId,
      now,
    );
    local.dirty = true;
    markRootDirty(local);
    if (isConflict) {
      counts.conflictsResolved += 1;
    } else {
      counts.pushed += 1;
    }
  } catch (error) {
    errors.push(`Push #${remote.id}: ${errorMessage(error)}`);
  }
}

function pullRemote(
  local: MutableTask,
  remote: VikunjaTask,
  parentId: number | null,
  key: string,
  ledger: LedgerStore,
  now: () => string,
  counts: MappingSyncCounts,
  isConflict: boolean,
): void {
  local.title = remote.title;
  local.descriptionLines = descriptionToLines(remote.description);
  if (local.done !== null) {
    local.done = remote.done;
    local.checkboxChar = checkboxCharForDone(remote.done, local.checkboxChar);
  }
  local.vikunjaTaskId = remote.id;
  local.dirty = true;
  markRootDirty(local);
  writeLedger(ledger, key, remote, parentId, now);
  if (isConflict) {
    counts.conflictsResolved += 1;
  } else {
    counts.pulled += 1;
  }
}

async function syncParentRelation(
  client: VikunjaClient,
  taskId: number,
  desiredParentId: number | null,
  currentParentId: number | null,
): Promise<void> {
  if (desiredParentId === currentParentId) {
    return;
  }
  if (currentParentId !== null) {
    try {
      await client.deleteRelation(taskId, currentParentId, 'subtask');
    } catch {
      // Relation may already be gone.
    }
  }
  if (desiredParentId !== null) {
    await ensureSubtaskRelation(client, taskId, desiredParentId);
  }
}

async function ensureSubtaskRelation(
  client: VikunjaClient,
  childId: number,
  parentId: number,
): Promise<void> {
  try {
    await client.createRelation(childId, {
      otherTaskId: parentId,
      relationKind: 'subtask',
    });
  } catch (error) {
    const message = errorMessage(error).toLowerCase();
    if (message.includes('already') || message.includes('exist')) {
      return;
    }
    throw error;
  }
}

function takePendingMatch(
  pending: PendingLink[],
  title: string,
  parentTaskId: number | null,
): PendingLink | null {
  const index = pending.findIndex(
    (item) => item.title === title && item.parentTaskId === parentTaskId,
  );
  if (index < 0) {
    return null;
  }
  const [match] = pending.splice(index, 1);
  return match ?? null;
}

function fakeCreatedTask(
  local: MutableTask,
  projectId: number,
  now: () => string,
): VikunjaTask {
  return {
    id: -Math.floor(Math.random() * 1_000_000) - 1,
    title: local.title,
    description: descriptionFromLines(local.descriptionLines),
    done: local.done ?? false,
    project_id: projectId,
    updated: now(),
  };
}

function writeLedger(
  ledger: LedgerStore,
  key: string,
  task: Pick<VikunjaTask, 'id' | 'title' | 'description' | 'done' | 'updated'>,
  parentTaskId: number | null,
  now: () => string,
): void {
  ledger.entries[ledgerEntryKey(key, task.id)] = makeLedgerEntry({
    taskId: task.id,
    mappingKey: key,
    title: task.title,
    description: normalizeDescription(task.description),
    done: task.done,
    parentTaskId,
    vikunjaUpdated: task.updated || now(),
    lastSyncedAt: now(),
    unresolved: false,
  });
}

function localSnapshot(
  local: MutableTask,
  parentId: number | null,
  entry: LedgerEntry | undefined,
) {
  return contentSnapshot({
    title: local.title,
    description: descriptionFromLines(local.descriptionLines),
    done: local.done === null ? (entry?.done ?? false) : local.done,
    parentTaskId: parentId,
  });
}

function remoteSnapshot(task: VikunjaTask, parentTaskId: number | null) {
  return contentSnapshot({
    title: task.title,
    description: normalizeDescription(task.description ?? ''),
    done: task.done,
    parentTaskId,
  });
}

function fromParsed(node: ParsedTaskNode, parent: MutableTask | null): MutableTask {
  const mutable: MutableTask = {
    lineIndex: node.lineIndex,
    endLineIndex: node.endLineIndex,
    indent: node.indent,
    listMarker: node.listMarker,
    checkboxChar: node.checkboxChar,
    done: node.done,
    title: node.title,
    descriptionLines: [...node.descriptionLines],
    vikunjaTaskId: node.vikunjaTaskId,
    children: [],
    parent,
    isNew: false,
    dirty: false,
  };
  mutable.children = node.children.map((child) => fromParsed(child, mutable));
  return mutable;
}

function createLocalNode(task: VikunjaTask): MutableTask {
  return {
    lineIndex: null,
    endLineIndex: null,
    indent: '',
    listMarker: '-',
    checkboxChar: task.done ? 'x' : ' ',
    done: task.done,
    title: task.title,
    descriptionLines: descriptionToLines(task.description),
    vikunjaTaskId: task.id,
    children: [],
    parent: null,
    isNew: true,
    dirty: true,
  };
}

function walkMutable(roots: MutableTask[], visit: (task: MutableTask) => void): void {
  const walk = (task: MutableTask): void => {
    visit(task);
    for (const child of task.children) {
      walk(child);
    }
  };
  for (const root of roots) {
    walk(root);
  }
}

function markRootDirty(task: MutableTask): void {
  let cursor: MutableTask | null = task;
  while (cursor.parent) {
    cursor = cursor.parent;
  }
  cursor.dirty = true;
}

function toRenderable(task: MutableTask): RenderableTask {
  return {
    indent: task.indent,
    listMarker: task.listMarker,
    checkboxChar: task.checkboxChar,
    title: task.title,
    vikunjaTaskId: task.vikunjaTaskId,
    descriptionLines: task.descriptionLines,
    children: task.children.map(toRenderable),
  };
}

function writeMarkdown(markdown: string, roots: MutableTask[], baseUrl: string): string {
  const replacements: Array<{
    lineIndex: number | null;
    endLineIndex: number | null;
    rendered: string;
  }> = [];

  for (const root of roots) {
    if (root.isNew) {
      replacements.push({
        lineIndex: null,
        endLineIndex: null,
        rendered: renderTask(toRenderable(root), baseUrl),
      });
      continue;
    }
    if (root.dirty || root.children.some(isDirtyTree)) {
      replacements.push({
        lineIndex: root.lineIndex,
        endLineIndex: root.endLineIndex,
        rendered: renderTask(toRenderable(root), baseUrl),
      });
    }
  }

  if (replacements.length === 0) {
    return markdown;
  }
  return applyRootReplacements(markdown, replacements);
}

function isDirtyTree(task: MutableTask): boolean {
  if (task.dirty || task.isNew) {
    return true;
  }
  return task.children.some(isDirtyTree);
}

export function normalizeNotePath(path: string): string {
  return path.trim().replace(/^\/+/, '');
}

function emptyCounts(): MappingSyncCounts {
  return {
    createdRemote: 0,
    createdLocal: 0,
    pushed: 0,
    pulled: 0,
    conflictsResolved: 0,
    unchanged: 0,
    unresolvedRemovals: 0,
    recoveredPendingLinks: 0,
  };
}

function addCounts(a: MappingSyncCounts, b: MappingSyncCounts): MappingSyncCounts {
  return {
    createdRemote: a.createdRemote + b.createdRemote,
    createdLocal: a.createdLocal + b.createdLocal,
    pushed: a.pushed + b.pushed,
    pulled: a.pulled + b.pulled,
    conflictsResolved: a.conflictsResolved + b.conflictsResolved,
    unchanged: a.unchanged + b.unchanged,
    unresolvedRemovals: a.unresolvedRemovals + b.unresolvedRemovals,
    recoveredPendingLinks: a.recoveredPendingLinks + b.recoveredPendingLinks,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeRun(
  totals: MappingSyncCounts,
  errorCount: number,
  mappingCount: number,
  dryRun: boolean,
): string {
  const parts = [
    `${mappingCount} mapping${mappingCount === 1 ? '' : 's'}`,
    `+${totals.createdRemote} remote`,
    `+${totals.createdLocal} local`,
    `${totals.pushed} pushed`,
    `${totals.pulled} pulled`,
    `${totals.conflictsResolved} conflicts`,
    `${totals.unresolvedRemovals} unresolved`,
  ];
  if (totals.recoveredPendingLinks > 0) {
    parts.push(`${totals.recoveredPendingLinks} recovered`);
  }
  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`);
  }
  const prefix = dryRun ? 'Vikunja Sync dry-run' : 'Vikunja Sync';
  return `${prefix}: ${parts.join(', ')}`;
}
