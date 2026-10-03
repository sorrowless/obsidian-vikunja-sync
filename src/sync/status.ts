/**
 * Obsidian ↔ Vikunja status via progress labels.
 *
 * Canonical progress labels (written by sync):
 *   ToDo         ↔ `[ ]`
 *   Done         ↔ `[x]` / `[X]`
 *   In Progress  ↔ `[/]`
 *
 * Reading: Done > ToDo > any other label(s) → in progress > no labels → todo.
 * Writing: remove every label on the task (any non-ToDo/Done label counts as a
 * progress/status label when reading), then attach exactly one canonical label.
 */

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export const STATUS_LABEL_TODO = 'ToDo';
export const STATUS_LABEL_DONE = 'Done';
export const STATUS_LABEL_IN_PROGRESS = 'In Progress';

/** Labels that represent workflow status and are swapped on sync. */
export const PROGRESS_LABEL_TITLES = [
  STATUS_LABEL_TODO,
  STATUS_LABEL_DONE,
  STATUS_LABEL_IN_PROGRESS,
] as const;

export function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'todo' || value === 'in_progress' || value === 'done';
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
 * Done / ToDo win when present; any other label(s) mean in progress;
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
