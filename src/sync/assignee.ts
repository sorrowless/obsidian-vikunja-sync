import {
  findAssigneeMappingByTag,
  findAssigneeMappingByUserId,
  normalizeObsidianTag,
  type AssigneeMapping,
} from '../settings';
import type { VikunjaClient } from '../vikunja/client';
import type { VikunjaTask, VikunjaUser } from '../vikunja/types';
import type { SyncActionDetail } from './actions';
import type { TaskStatus } from './status';

export interface AssigneeReconcileInput {
  client: VikunjaClient;
  taskTitle: string;
  taskId: number;
  localStatus: TaskStatus | null;
  remoteStatus: TaskStatus;
  localTags: string[];
  remoteAssignees: VikunjaUser[];
  mappings: readonly AssigneeMapping[];
  dryRun: boolean;
}

export interface AssigneeReconcileResult {
  /** Updated local tags when Obsidian was changed (or would change). */
  tags: string[] | null;
  /** Assignee tag currently desired on the note (mapped), or null. */
  assigneeTag: string | null;
  actions: SyncActionDetail[];
  /** Remote assignees after reconcile (best-effort for ledger/UI). */
  assignees: VikunjaUser[];
}

/**
 * Reconcile a single mapped assignee/tag for an open task.
 * Skips when both sides are Done. Obsidian wins on conflict.
 */
export async function reconcileAssignee(
  input: AssigneeReconcileInput,
): Promise<AssigneeReconcileResult> {
  const actions: SyncActionDetail[] = [];
  const mappings = input.mappings.filter(
    (m) => m.vikunjaUserId > 0 && normalizeObsidianTag(m.obsidianTag).length > 0,
  );

  if (mappings.length === 0) {
    return {
      tags: null,
      assigneeTag: resolveLocalMappedTag(input.localTags, mappings),
      actions,
      assignees: input.remoteAssignees,
    };
  }

  if (input.localStatus === 'done' && input.remoteStatus === 'done') {
    return {
      tags: null,
      assigneeTag: resolveLocalMappedTag(input.localTags, mappings),
      actions,
      assignees: input.remoteAssignees,
    };
  }

  const localMapped = resolveLocalMappedTag(input.localTags, mappings);
  const remoteMapped = resolveRemoteMappedAssignee(input.remoteAssignees, mappings);
  const mappedTagNames = new Set(
    mappings.map((m) => normalizeObsidianTag(m.obsidianTag).toLowerCase()),
  );

  // Both empty (for sync purposes) → nothing to do.
  if (!localMapped && !remoteMapped) {
    return {
      tags: null,
      assigneeTag: null,
      actions,
      assignees: input.remoteAssignees,
    };
  }

  // Obsidian empty, Vikunja has mapped assignee → pull tag into note.
  if (!localMapped && remoteMapped) {
    const mapping = findAssigneeMappingByUserId(mappings, remoteMapped.id);
    if (!mapping) {
      return {
        tags: null,
        assigneeTag: null,
        actions,
        assignees: input.remoteAssignees,
      };
    }
    const tag = normalizeObsidianTag(mapping.obsidianTag);
    const nextTags = mergeAssigneeTag(input.localTags, mappedTagNames, tag);
    actions.push({
      kind: 'assignee-set-obsidian',
      title: input.taskTitle,
      taskId: input.taskId,
      detail: `#${tag} ← Vikunja user ${remoteMapped.id}`,
    });
    return {
      tags: nextTags,
      assigneeTag: tag,
      actions,
      assignees: input.remoteAssignees,
    };
  }

  // Obsidian has mapped tag; Vikunja missing or different → Obsidian wins.
  if (localMapped) {
    const mapping = findAssigneeMappingByTag(mappings, localMapped);
    if (!mapping) {
      return {
        tags: null,
        assigneeTag: localMapped,
        actions,
        assignees: input.remoteAssignees,
      };
    }

    const desiredUserId = mapping.vikunjaUserId;
    if (remoteMapped?.id === desiredUserId) {
      return {
        tags: null,
        assigneeTag: localMapped,
        actions,
        assignees: input.remoteAssignees,
      };
    }

    actions.push({
      kind: 'assignee-set-vikunja',
      title: input.taskTitle,
      taskId: input.taskId,
      detail: `user ${desiredUserId} ← #${localMapped}`,
    });

    let nextAssignees = [...input.remoteAssignees];
    if (!input.dryRun) {
      for (const user of input.remoteAssignees) {
        if (user.id === desiredUserId) {
          continue;
        }
        // Remove other assignees so the task has a single assignee.
        try {
          await input.client.removeAssignee(input.taskId, user.id);
        } catch {
          // May already be gone.
        }
      }
      const stillHas = input.remoteAssignees.some((u) => u.id === desiredUserId);
      if (!stillHas) {
        await input.client.addAssignee(input.taskId, desiredUserId);
      }
      nextAssignees = [
        {
          id: desiredUserId,
          username: mapping.label || String(desiredUserId),
        },
      ];
    } else {
      nextAssignees = [
        {
          id: desiredUserId,
          username: mapping.label || String(desiredUserId),
        },
      ];
    }

    return {
      tags: null,
      assigneeTag: localMapped,
      actions,
      assignees: nextAssignees,
    };
  }

  return {
    tags: null,
    assigneeTag: null,
    actions,
    assignees: input.remoteAssignees,
  };
}

export function resolveLocalMappedTag(
  tags: readonly string[],
  mappings: readonly AssigneeMapping[],
): string | null {
  for (const tag of tags) {
    const mapping = findAssigneeMappingByTag(mappings, tag);
    if (mapping) {
      return normalizeObsidianTag(mapping.obsidianTag);
    }
  }
  return null;
}

export function resolveRemoteMappedAssignee(
  assignees: readonly VikunjaUser[],
  mappings: readonly AssigneeMapping[],
): VikunjaUser | null {
  for (const user of assignees) {
    if (findAssigneeMappingByUserId(mappings, user.id)) {
      return user;
    }
  }
  return null;
}

export function mappedTagNameSet(mappings: readonly AssigneeMapping[]): Set<string> {
  return new Set(
    mappings
      .map((m) => normalizeObsidianTag(m.obsidianTag))
      .filter((t) => t.length > 0)
      .map((t) => t.toLowerCase()),
  );
}

function mergeAssigneeTag(
  existing: readonly string[],
  mappedLower: ReadonlySet<string>,
  assigneeTag: string,
): string[] {
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const tag of existing) {
    const normalized = normalizeObsidianTag(tag);
    const key = normalized.toLowerCase();
    if (!normalized || mappedLower.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(normalized);
  }
  const assigneeKey = assigneeTag.toLowerCase();
  if (!seen.has(assigneeKey)) {
    kept.push(assigneeTag);
  }
  return kept;
}

/** Apply remote mapped assignee onto local tags for import/create-local. */
export function tagsFromRemoteAssignee(
  existingTags: readonly string[],
  remote: Pick<VikunjaTask, 'assignees'>,
  mappings: readonly AssigneeMapping[],
): string[] {
  const mapped = resolveRemoteMappedAssignee(remote.assignees, mappings);
  if (!mapped) {
    return [...existingTags];
  }
  const mapping = findAssigneeMappingByUserId(mappings, mapped.id);
  if (!mapping) {
    return [...existingTags];
  }
  return mergeAssigneeTag(
    existingTags,
    mappedTagNameSet(mappings),
    normalizeObsidianTag(mapping.obsidianTag),
  );
}
