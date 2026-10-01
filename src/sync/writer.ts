import { taskPageUrl } from '../vikunja/urls';

export interface RenderableTask {
  indent: string;
  listMarker: string;
  checkboxChar: string;
  title: string;
  vikunjaTaskId: number | null;
  descriptionLines: string[];
  children: RenderableTask[];
}

const DEFAULT_INDENT_UNIT = '    ';

/**
 * Render a task forest to canonical Markdown blocks.
 * Description lines come before children. Linked tasks use [title](url).
 */
export function renderTaskForest(
  tasks: RenderableTask[],
  baseUrl: string,
  indentUnit = DEFAULT_INDENT_UNIT,
): string {
  return tasks.map((task) => renderTask(task, baseUrl, indentUnit)).join('\n');
}

export function renderTask(
  task: RenderableTask,
  baseUrl: string,
  indentUnit = DEFAULT_INDENT_UNIT,
): string {
  const lines: string[] = [];
  const body =
    task.vikunjaTaskId !== null
      ? `[${task.title}](${taskPageUrl(baseUrl, task.vikunjaTaskId)})`
      : task.title;
  lines.push(`${task.indent}${task.listMarker} [${task.checkboxChar}] ${body}`);

  const childIndent = `${task.indent}${indentUnit}`;
  for (const desc of task.descriptionLines) {
    lines.push(`${childIndent}- ${desc}`);
  }
  for (const child of task.children) {
    const renderedChild = renderTask(
      {
        ...child,
        indent: child.indent || childIndent,
      },
      baseUrl,
      indentUnit,
    );
    lines.push(renderedChild);
  }
  return lines.join('\n');
}

/**
 * Replace existing root task blocks (by line range) and append new roots.
 * `roots` entries with `lineIndex === null` are treated as brand-new appends.
 */
export function applyRootReplacements(
  markdown: string,
  replacements: Array<{
    lineIndex: number | null;
    endLineIndex: number | null;
    rendered: string;
  }>,
): string {
  const lines = markdown.split(/\r?\n/);
  const existing = replacements
    .filter((item) => item.lineIndex !== null && item.endLineIndex !== null)
    .sort((a, b) => (b.lineIndex as number) - (a.lineIndex as number));

  for (const item of existing) {
    const start = item.lineIndex as number;
    const end = item.endLineIndex as number;
    const blockLines = item.rendered.split(/\r?\n/);
    lines.splice(start, end - start + 1, ...blockLines);
  }

  const appended = replacements
    .filter((item) => item.lineIndex === null)
    .map((item) => item.rendered);

  if (appended.length === 0) {
    return lines.join('\n');
  }

  let result = lines.join('\n');
  if (result.length > 0 && !result.endsWith('\n')) {
    result += '\n';
  }
  if (result.length > 0) {
    result += '\n';
  }
  result += appended.join('\n');
  if (!result.endsWith('\n')) {
    result += '\n';
  }
  return result;
}

export function checkboxCharForDone(done: boolean, previous: string): string {
  if (previous !== ' ' && previous !== 'x' && previous !== 'X') {
    return previous;
  }
  return done ? 'x' : ' ';
}

export function defaultNewTask(title: string, taskId: number, done: boolean): RenderableTask {
  return {
    indent: '',
    listMarker: '-',
    checkboxChar: done ? 'x' : ' ',
    title,
    vikunjaTaskId: taskId,
    descriptionLines: [],
    children: [],
  };
}
