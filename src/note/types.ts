import type { TaskStatus } from '../sync/status';

export interface ParsedTaskNode {
  /** 0-based line index of the checklist item in the source note. */
  lineIndex: number;
  /** Inclusive last line index of this task block (descriptions + descendants). */
  endLineIndex: number;
  /** Leading whitespace before the list marker. */
  indent: string;
  /** List marker as written (`-`, `*`, `1.`). */
  listMarker: string;
  /** Character inside the brackets (` `, `x`, `X`, `/`, …). */
  checkboxChar: string;
  /**
   * Legacy done flag: true for x/X, false for space, null for other chars.
   * Prefer `status` for sync logic.
   */
  done: boolean | null;
  /**
   * Synced workflow status: todo `[ ]`, in_progress `[/]`, done `[x]`/`[X]`.
   * `null` when the checkbox is outside the sync contract (e.g. `[-]`).
   */
  status: TaskStatus | null;
  /** Task title (link text when linked, otherwise body without date tokens). */
  title: string;
  /** Vikunja task id when the body is a link to this instance. */
  vikunjaTaskId: number | null;
  /** ISO UTC start time, or null when unset. Synced to Vikunja `start_date`. */
  startDate: string | null;
  /** ISO UTC end time, or null when unset. Synced to Vikunja `end_date`. */
  endDate: string | null;
  /** Indented non-checkbox bullets under this task (description). */
  descriptionLines: string[];
  /** Source line indices for descriptionLines (parallel array). */
  descriptionLineIndices: number[];
  /** Nested checklist children. */
  children: ParsedTaskNode[];
}

export interface ParseNoteOptions {
  vikunjaBaseUrl: string;
}
