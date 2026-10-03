import { extractTaskIdFromUrl } from '../vikunja/urls';
import { parseTaskDates } from './dates';
import type { ParseNoteOptions, ParsedTaskNode } from './types';
import {
  doneFlagFromStatus,
  statusFromCheckbox,
  type TaskStatus,
} from '../sync/status';

const TASK_LINE =
  /^([\t >]*)([-*]|[0-9]+\.)\s+\[(.)\]\s+(.*)$/u;
const BULLET_LINE =
  /^([\t >]*)([-*]|[0-9]+\.)\s+(.*)$/u;
/** Link at the start of the body, with optional trailing metadata (dates, etc.). */
const LINK_AT_START = /^\[([^\]]*)\]\(([^)\s]+)\)\s*(.*)$/u;

interface FlatTask {
  lineIndex: number;
  indent: string;
  indentWidth: number;
  listMarker: string;
  checkboxChar: string;
  done: boolean | null;
  status: TaskStatus | null;
  title: string;
  vikunjaTaskId: number | null;
  startDate: string | null;
  endDate: string | null;
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
      const resolved = resolveTaskBody(body, options.vikunjaBaseUrl);
      const status = statusFromCheckbox(checkboxChar);

      tasks.push({
        lineIndex: i,
        indent,
        indentWidth: indentWidth(indent),
        listMarker,
        checkboxChar,
        done: status === null ? null : doneFlagFromStatus(status),
        status,
        title: resolved.title,
        vikunjaTaskId: resolved.vikunjaTaskId,
        startDate: resolved.startDate,
        endDate: resolved.endDate,
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

function resolveTaskBody(
  body: string,
  vikunjaBaseUrl: string,
): {
  title: string;
  vikunjaTaskId: number | null;
  startDate: string | null;
  endDate: string | null;
} {
  const linkMatch = body.match(LINK_AT_START);
  if (linkMatch) {
    const linkTitle = linkMatch[1] ?? '';
    const url = linkMatch[2] ?? '';
    const trailing = linkMatch[3] ?? '';
    const dates = parseTaskDates(trailing);
    return {
      title: linkTitle,
      vikunjaTaskId: extractTaskIdFromUrl(url, vikunjaBaseUrl),
      startDate: dates.startDate,
      endDate: dates.endDate,
    };
  }

  const dates = parseTaskDates(body);
  return {
    title: dates.remainder,
    vikunjaTaskId: null,
    startDate: dates.startDate,
    endDate: dates.endDate,
  };
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
      status: task.status,
      title: task.title,
      vikunjaTaskId: task.vikunjaTaskId,
      startDate: task.startDate,
      endDate: task.endDate,
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
