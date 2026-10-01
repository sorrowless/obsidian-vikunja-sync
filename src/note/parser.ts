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
  descriptionLineIndices: number[];
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
        descriptionLineIndices: [],
      });
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE);
    if (bulletMatch) {
      const body = (bulletMatch[3] ?? '').trim();
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
  const roots = buildTree(tasks);
  assignEndLines(roots);
  return roots;
}

export function indentWidth(indent: string): number {
  let width = 0;
  for (const ch of indent) {
    if (ch === '\t') {
      width += 4;
    } else if (ch === ' ') {
      width += 1;
    }
  }
  return width;
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

function assignDescriptions(tasks: FlatTask[], bullets: FlatBullet[]): void {
  for (const bullet of bullets) {
    let owner: FlatTask | null = null;
    for (const task of tasks) {
      if (task.lineIndex >= bullet.lineIndex) {
        break;
      }
      if (bullet.indentWidth > task.indentWidth) {
        owner = task;
      }
    }
    if (owner) {
      owner.descriptionLines.push(bullet.text);
      owner.descriptionLineIndices.push(bullet.lineIndex);
    }
  }
}

function buildTree(tasks: FlatTask[]): ParsedTaskNode[] {
  const roots: ParsedTaskNode[] = [];
  const stack: Array<{ width: number; node: ParsedTaskNode }> = [];

  for (const task of tasks) {
    const node: ParsedTaskNode = {
      lineIndex: task.lineIndex,
      endLineIndex: task.lineIndex,
      indent: task.indent,
      listMarker: task.listMarker,
      checkboxChar: task.checkboxChar,
      done: task.done,
      title: task.title,
      vikunjaTaskId: task.vikunjaTaskId,
      descriptionLines: [...task.descriptionLines],
      descriptionLineIndices: [...task.descriptionLineIndices],
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

function assignEndLines(nodes: ParsedTaskNode[]): void {
  for (const node of nodes) {
    assignEndLines(node.children);
    let end = node.lineIndex;
    for (const idx of node.descriptionLineIndices) {
      end = Math.max(end, idx);
    }
    for (const child of node.children) {
      end = Math.max(end, child.endLineIndex);
    }
    node.endLineIndex = end;
  }
}
