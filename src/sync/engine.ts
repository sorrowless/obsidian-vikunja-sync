import { parseNoteTasks } from '../note/parser';
import type { ParsedTaskNode } from '../note/types';
import type { ConflictPolicy } from '../settings';
import type { VikunjaClient } from '../vikunja/client';
import type { VikunjaTask } from '../vikunja/types';
import {
  emptyActions,
  type SyncActionDetail,
} from './actions';
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
  /** Per-task actions for informative dry-run / sync reports. */
  actions: SyncActionDetail[];
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

export type { SyncActionDetail } from './actions';

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
  startDate: string | null;
  endDate: string | null;
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
        actions: emptyActions(),
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
        actions: emptyActions(),
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
  const allActions = results.flatMap((item) => item.actions);

  return {
    mappings: results,
    dryRun,
    message: summarizeRun(totals, errorCount, mappings.length, dryRun, allActions),
  };
}

async function syncOneMapping(
  mapping: SyncMapping,
  ledger: LedgerStore,
  pendingLinks: PendingLink[],
  options: SyncEngineOptions,
): Promise<MappingSyncResult> {
  const counts = emptyCounts();
  const actions = emptyActions();
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
          start_date: local.startDate,
          end_date: local.endDate,
        }, parentId, now);
        counts.recoveredPendingLinks += 1;
        counts.createdRemote += 1;
        actions.push({
          kind: 'recovered-pending',
          title: local.title,
          taskId: recovered.taskId,
          detail: 'relink previously created Vikunja task that was not yet written into the note',
        });
        continue;
      }

      try {
        const created = dryRun
          ? fakeCreatedTask(local, mapping.projectId, now)
          : await options.client.createTask(mapping.projectId, {
              title: local.title,
              description: descriptionFromLines(local.descriptionLines),
              done: local.done ?? false,
              start_date: local.startDate,
              end_date: local.endDate,
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
        actions.push({
          kind: 'create-remote',
          title: local.title,
          taskId: created.id > 0 ? created.id : null,
          detail: 'unlinked checklist item in the note',
        });
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
        actions.push({
          kind: 'unresolved-missing-remote',
          title: local.title || entry.title,
          taskId,
          detail: 'still linked in the note, but Vikunja no longer returns this task',
        });
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
        actions.push({ kind: 'unchanged', title: local.title, taskId });
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
          actions,
          errors,
          true,
          dryRun,
        );
      } else {
        pullRemote(
          local,
          remote.task,
          remote.parentTaskId,
          key,
          workingLedger,
          now,
          counts,
          actions,
          true,
        );
      }
      continue;
    }

    const localChanged = localHash !== entry.contentHash;
    const remoteChanged =
      remoteHash !== entry.contentHash || remote.task.updated !== entry.vikunjaUpdated;

    if (!localChanged && !remoteChanged) {
      entry.unresolved = false;
      counts.unchanged += 1;
      actions.push({ kind: 'unchanged', title: local.title, taskId });
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
        actions,
        errors,
        false,
        dryRun,
      );
      continue;
    }

    if (!localChanged && remoteChanged) {
      pullRemote(
        local,
        remote.task,
        remote.parentTaskId,
        key,
        workingLedger,
        now,
        counts,
        actions,
        false,
      );
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
        actions,
        errors,
        true,
        dryRun,
      );
    } else {
      pullRemote(
        local,
        remote.task,
        remote.parentTaskId,
        key,
        workingLedger,
        now,
        counts,
        actions,
        true,
      );
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
      actions.push({
        kind: 'unresolved-missing-local',
        title: entry.title || remote.task.title,
        taskId: remote.task.id,
        detail: 'was synced before, still exists in Vikunja, but is no longer in the note',
      });
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
    actions.push({
      kind: 'create-local',
      title: remote.task.title,
      taskId: remote.task.id,
      detail: 'exists in Vikunja and was never synced to this note',
    });
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
        actions,
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
        actions,
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
    actions,
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
  actions: SyncActionDetail[],
  errors: string[],
  isConflict: boolean,
  dryRun: boolean,
): Promise<void> {
  try {
    const update: {
      title: string;
      description: string;
      done?: boolean;
      start_date: string | null;
      end_date: string | null;
    } = {
      title: local.title,
      description: descriptionFromLines(local.descriptionLines),
      start_date: local.startDate,
      end_date: local.endDate,
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
          start_date: local.startDate,
          end_date: local.endDate,
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
        start_date: local.startDate,
        end_date: local.endDate,
      },
      parentId,
      now,
    );
    local.dirty = true;
    markRootDirty(local);
    if (isConflict) {
      counts.conflictsResolved += 1;
      actions.push({
        kind: 'conflict-push',
        title: local.title,
        taskId: remote.id,
        detail: 'both sides changed; Obsidian wins',
      });
    } else {
      counts.pushed += 1;
      actions.push({
        kind: 'push',
        title: local.title,
        taskId: remote.id,
      });
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
  actions: SyncActionDetail[],
  isConflict: boolean,
): void {
  local.title = remote.title;
  local.descriptionLines = descriptionToLines(remote.description);
  if (local.done !== null) {
    local.done = remote.done;
    local.checkboxChar = checkboxCharForDone(remote.done, local.checkboxChar);
  }
  local.startDate = remote.start_date;
  local.endDate = remote.end_date;
  local.vikunjaTaskId = remote.id;
  local.dirty = true;
  markRootDirty(local);
  writeLedger(ledger, key, remote, parentId, now);
  if (isConflict) {
    counts.conflictsResolved += 1;
    actions.push({
      kind: 'conflict-pull',
      title: remote.title,
      taskId: remote.id,
      detail: 'both sides changed; Vikunja wins',
    });
  } else {
    counts.pulled += 1;
    actions.push({
      kind: 'pull',
      title: remote.title,
      taskId: remote.id,
    });
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
    start_date: local.startDate,
    end_date: local.endDate,
  };
}

function writeLedger(
  ledger: LedgerStore,
  key: string,
  task: Pick<
    VikunjaTask,
    'id' | 'title' | 'description' | 'done' | 'updated' | 'start_date' | 'end_date'
  >,
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
    startDate: task.start_date ?? null,
    endDate: task.end_date ?? null,
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
    startDate: local.startDate,
    endDate: local.endDate,
  });
}

function remoteSnapshot(task: VikunjaTask, parentTaskId: number | null) {
  return contentSnapshot({
    title: task.title,
    description: normalizeDescription(task.description ?? ''),
    done: task.done,
    parentTaskId,
    startDate: task.start_date ?? null,
    endDate: task.end_date ?? null,
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
    startDate: node.startDate,
    endDate: node.endDate,
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
    startDate: task.start_date ?? null,
    endDate: task.end_date ?? null,
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
    startDate: task.startDate,
    endDate: task.endDate,
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
  actions: SyncActionDetail[],
): string {
  const prefix = dryRun ? 'Vikunja Sync dry-run' : 'Vikunja Sync';
  const parts = [`${mappingCount} mapping${mappingCount === 1 ? '' : 's'}`];

  const createRemote = countKind(actions, 'create-remote');
  const createLocal = countKind(actions, 'create-local');
  const push = countKind(actions, 'push');
  const pull = countKind(actions, 'pull');
  const conflicts =
    countKind(actions, 'conflict-push') + countKind(actions, 'conflict-pull');
  const unresolved =
    countKind(actions, 'unresolved-missing-remote') +
    countKind(actions, 'unresolved-missing-local');
  const recovered = countKind(actions, 'recovered-pending');

  if (createRemote > 0) {
    parts.push(
      dryRun
        ? `${createRemote} would create in Vikunja`
        : `${createRemote} created in Vikunja`,
    );
  }
  if (createLocal > 0) {
    parts.push(
      dryRun
        ? `${createLocal} would import into Obsidian`
        : `${createLocal} imported into Obsidian`,
    );
  }
  if (push > 0) {
    parts.push(dryRun ? `${push} would push` : `${push} pushed`);
  }
  if (pull > 0) {
    parts.push(dryRun ? `${pull} would pull` : `${pull} pulled`);
  }
  if (conflicts > 0) {
    parts.push(
      dryRun ? `${conflicts} would resolve conflict` : `${conflicts} conflict resolved`,
    );
  }
  if (recovered > 0) {
    parts.push(dryRun ? `${recovered} would relink` : `${recovered} relinked`);
  }
  if (unresolved > 0) {
    parts.push(`${unresolved} unresolved`);
  }
  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`);
  }

  // Fall back to totals when nothing notable happened (all unchanged).
  if (parts.length === 1 && totals.unchanged > 0) {
    parts.push(`${totals.unchanged} unchanged`);
  } else if (parts.length === 1) {
    parts.push('nothing to do');
  }

  return `${prefix}: ${parts.join(', ')}`;
}

function countKind(actions: SyncActionDetail[], kind: SyncActionDetail['kind']): number {
  return actions.reduce((sum, action) => sum + (action.kind === kind ? 1 : 0), 0);
}
