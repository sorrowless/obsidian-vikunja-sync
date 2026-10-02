export type SyncActionKind =
  | 'create-remote'
  | 'create-local'
  | 'push'
  | 'pull'
  | 'conflict-push'
  | 'conflict-pull'
  | 'unchanged'
  | 'unresolved-missing-remote'
  | 'unresolved-missing-local'
  | 'recovered-pending';

export interface SyncActionDetail {
  kind: SyncActionKind;
  /** Human-readable task title. */
  title: string;
  taskId?: number | null;
  /** Extra context shown in the report. */
  detail?: string;
}

export function emptyActions(): SyncActionDetail[] {
  return [];
}

export function formatActionLabel(kind: SyncActionKind, dryRun: boolean): string {
  const prefix = dryRun ? 'Would ' : '';
  switch (kind) {
    case 'create-remote':
      return `${prefix}create in Vikunja`;
    case 'create-local':
      return `${prefix}import into Obsidian`;
    case 'push':
      return `${prefix}update Vikunja from Obsidian`;
    case 'pull':
      return `${prefix}update Obsidian from Vikunja`;
    case 'conflict-push':
      return `${prefix}resolve conflict → Obsidian wins (push)`;
    case 'conflict-pull':
      return `${prefix}resolve conflict → Vikunja wins (pull)`;
    case 'unchanged':
      return 'Unchanged';
    case 'unresolved-missing-remote':
      return 'Unresolved — linked in note, missing in Vikunja';
    case 'unresolved-missing-local':
      return 'Unresolved — known from ledger, missing in note';
    case 'recovered-pending':
      return `${prefix}relink pending Vikunja task`;
    default: {
      const _exhaustive: never = kind;
      return String(_exhaustive);
    }
  }
}

/** Ordered sections for the user-facing report (unchanged last / omitted when empty). */
export const ACTION_REPORT_ORDER: SyncActionKind[] = [
  'create-remote',
  'create-local',
  'push',
  'pull',
  'conflict-push',
  'conflict-pull',
  'recovered-pending',
  'unresolved-missing-remote',
  'unresolved-missing-local',
  // 'unchanged' intentionally omitted from detailed lists by default
];
