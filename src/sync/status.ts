/**
 * Obsidian ↔ Vikunja status via progress labels.
 *
 * Canonical progress labels (written by sync):
 *   ToDo         ↔ `[ ]`
 *   In Progress  ↔ `[/]`
 *   Review       ↔ `[?]`
 *   Done         ↔ `[x]` / `[X]`
 *
 * Reading: Done > ToDo > Review > In Progress (explicit) > any other label(s)
 * → in progress > no labels → todo.
 * Writing: remove every non-desired label, then attach exactly one canonical label.
 */

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';

export const STATUS_LABEL_TODO = 'ToDo';
export const STATUS_LABEL_DONE = 'Done';
export const STATUS_LABEL_IN_PROGRESS = 'In Progress';
export const STATUS_LABEL_REVIEW = 'Review';

/** Labels that represent workflow status and are swapped on sync. */
export const PROGRESS_LABEL_TITLES = [
  STATUS_LABEL_TODO,
  STATUS_LABEL_DONE,
  STATUS_LABEL_IN_PROGRESS,
  STATUS_LABEL_REVIEW,
] as const;

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    value === 'todo' ||
    value === 'in_progress' ||
    value === 'review' ||
    value === 'done'
  );
}

/** Map an Obsidian checkbox character to a synced status. */
export function statusFromCheckbox(checkboxChar: string): TaskStatus | null {
  if (checkboxChar === ' ') {
    return 'todo';
  }
  if (checkboxChar === 'x' || checkboxChar === 'X') {
    return 'done';
  }
  if (checkboxChar === '/') {
    return 'in_progress';
  }
  if (checkboxChar === '?') {
    return 'review';
  }
  // Other characters (e.g. `-`) are not part of the sync contract.
  return null;
}

/** Checkbox character written back into Obsidian for a status. */
export function checkboxFromStatus(status: TaskStatus): string {
  switch (status) {
    case 'todo':
      return ' ';
    case 'in_progress':
      return '/';
    case 'review':
      return '?';
    case 'done':
      return 'x';
    default: {
      const _exhaustive: never = status;
      return String(_exhaustive);
    }
  }
}

export function labelTitleForStatus(status: TaskStatus): string {
  switch (status) {
    case 'todo':
      return STATUS_LABEL_TODO;
    case 'in_progress':
      return STATUS_LABEL_IN_PROGRESS;
    case 'review':
      return STATUS_LABEL_REVIEW;
    case 'done':
      return STATUS_LABEL_DONE;
    default: {
      const _exhaustive: never = status;
      return String(_exhaustive);
    }
  }
}

export function isProgressLabelTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return PROGRESS_LABEL_TITLES.some((item) => item.toLowerCase() === normalized);
}

/**
 * Derive status from Vikunja task labels.
 * Done > ToDo > Review > In Progress (explicit) > any other → in progress;
 * no labels default to todo.
 */
export function statusFromLabels(
  labels: ReadonlyArray<{ title: string }> | null | undefined,
): TaskStatus {
  const titles = (labels ?? []).map((label) => label.title.trim().toLowerCase());
  if (titles.includes(STATUS_LABEL_DONE.toLowerCase())) {
    return 'done';
  }
  if (titles.includes(STATUS_LABEL_TODO.toLowerCase())) {
    return 'todo';
  }
  if (titles.includes(STATUS_LABEL_REVIEW.toLowerCase())) {
    return 'review';
  }
  if (titles.includes(STATUS_LABEL_IN_PROGRESS.toLowerCase())) {
    return 'in_progress';
  }
  if (titles.length > 0) {
    return 'in_progress';
  }
  return 'todo';
}

/** Keep `done` boolean aligned with the status label for Vikunja UI consistency. */
export function doneFlagFromStatus(status: TaskStatus): boolean {
  return status === 'done';
}

/** Legacy ledger boolean → status. */
export function statusFromDoneFlag(done: boolean): TaskStatus {
  return done ? 'done' : 'todo';
}
