import { extractTaskIdFromUrl, parseMarkdownLink } from '../vikunja/urls';
import type { ParseNoteOptions, ParsedTaskNode } from './types';

const TASK_LINE =
  /^([\t >]*)([-*]|[0-9]+\.)\s+\[(.)\]\s+(.*)$/u;
const BULLET_LINE =
  /^([\t >]*)([-*]|[0-9]+\.)\s+(.*)$/u;

interface FlatTask {
  lineIndex: number;
  indent: string;
  indentWidth: number;
  listMarker: string;
  checkboxChar: string;
  done: boolean | null;
  title: string;
  vikunjaTaskId: number | null;
  descriptionLines: string[];
}

interface FlatBullet {
  lineIndex: number;
  indentWidth: number;
  text: string;
}

/**
 * Parse Obsidian checklist tasks from a Markdown note into a forest.
 * Nested checklist items become children; indented bullets without checkboxes
 * become description lines on the nearest less-indented task.
 */
export function parseNoteTasks(markdown: string, options: ParseNoteOptions): ParsedTaskNode[] {
  const lines = markdown.split(/\r?\n/);
  const tasks: FlatTask[] = [];
  const bullets: FlatBullet[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const taskMatch = line.match(TASK_LINE);
    if (taskMatch) {
      const indent = taskMatch[1] ?? '';
      const listMarker = taskMatch[2] ?? '-';
      const checkboxChar = taskMatch[3] ?? ' ';
      const body = (taskMatch[4] ?? '').trimEnd();
      const { title, vikunjaTaskId } = resolveTitleAndId(body, options.vikunjaBaseUrl);

      tasks.push({
        lineIndex: i,
        indent,
        indentWidth: indentWidth(indent),
        listMarker,
        checkboxChar,
        done: doneFromCheckbox(checkboxChar),
        title,
        vikunjaTaskId,
        descriptionLines: [],
      });
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE);
    if (bulletMatch) {
      const body = (bulletMatch[3] ?? '').trim();
      // Skip checklist-looking lines already handled; remaining are description bullets.
      if (/^\[.\]\s+/.test(body)) {
        continue;
      }
      bullets.push({
        lineIndex: i,
        indentWidth: indentWidth(bulletMatch[1] ?? ''),
        text: body,
      });
    }
  }

  assignDescriptions(tasks, bullets);
  return buildTree(tasks);
}

function resolveTitleAndId(
  body: string,
  vikunjaBaseUrl: string,
): { title: string; vikunjaTaskId: number | null } {
  const link = parseMarkdownLink(body);
  if (!link) {
    return { title: body.trim(), vikunjaTaskId: null };
  }

  const taskId = extractTaskIdFromUrl(link.url, vikunjaBaseUrl);
  return {
    title: link.title,
    vikunjaTaskId: taskId,
  };
}

function doneFromCheckbox(checkboxChar: string): boolean | null {
  if (checkboxChar === ' ') {
    return false;
  }
  if (checkboxChar === 'x' || checkboxChar === 'X') {
    return true;
  }
  return null;
}

function indentWidth(indent: string): number {
  let width = 0;
  for (const ch of indent) {
    if (ch === '\t') {
      width += 4;
    } else if (ch === ' ') {
      width += 1;
    }
    // Ignore blockquote markers `>` for width comparison of nested lists inside quotes.
  }
  return width;
}

function assignDescriptions(tasks: FlatTask[], bullets: FlatBullet[]): void {
  for (const bullet of bullets) {
    // Deepest preceding task with strictly smaller indent owns the bullet.
    let owner: FlatTask | null = null;
    for (const task of tasks) {
      if (task.lineIndex >= bullet.lineIndex) {
        break;
      }
      if (bullet.indentWidth > task.indentWidth) {
        owner = task;
      }
    }
    owner?.descriptionLines.push(bullet.text);
  }
}

function buildTree(tasks: FlatTask[]): ParsedTaskNode[] {
  const roots: ParsedTaskNode[] = [];
  const stack: Array<{ width: number; node: ParsedTaskNode }> = [];

  for (const task of tasks) {
    const node: ParsedTaskNode = {
      lineIndex: task.lineIndex,
      indent: task.indent,
      listMarker: task.listMarker,
      checkboxChar: task.checkboxChar,
      done: task.done,
      title: task.title,
      vikunjaTaskId: task.vikunjaTaskId,
      descriptionLines: [...task.descriptionLines],
      children: [],
    };

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top || top.width < task.indentWidth) {
        break;
      }
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1]?.node.children.push(node);
    }

    stack.push({ width: task.indentWidth, node });
  }

  return roots;
}
