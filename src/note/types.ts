export interface ParsedTaskNode {
  /** 0-based line index of the checklist item in the source note. */
  lineIndex: number;
  /** Leading whitespace before the list marker. */
  indent: string;
  /** List marker as written (`-`, `*`, `1.`). */
  listMarker: string;
  /** Character inside the brackets (` `, `x`, `X`, `/`, …). */
  checkboxChar: string;
  /**
   * Synced done flag: true for x/X, false for space.
   * `null` means the checkbox character is not synced for done state.
   */
  done: boolean | null;
  /** Task title (link text when linked, otherwise full body). */
  title: string;
  /** Vikunja task id when the body is a link to this instance. */
  vikunjaTaskId: number | null;
  /** Indented non-checkbox bullets under this task (description). */
  descriptionLines: string[];
  /** Nested checklist children. */
  children: ParsedTaskNode[];
}

export interface ParseNoteOptions {
  vikunjaBaseUrl: string;
}
