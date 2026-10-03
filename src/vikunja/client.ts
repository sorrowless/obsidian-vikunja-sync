import { apiRoot, normalizeBaseUrl } from './urls';
import { createFetchTransport, type HttpTransport } from './http';
import { normalizeVikunjaDate, toVikunjaDatePayload } from '../note/dates';
import {
  VikunjaApiError,
  type CreateRelationInput,
  type CreateTaskInput,
  type UpdateTaskInput,
  type VikunjaLabel,
  type VikunjaProject,
  type VikunjaRelationKind,
  type VikunjaTask,
} from './types';

export interface VikunjaClientOptions {
  baseUrl: string;
  token: string;
  /**
   * HTTP transport. Prefer Obsidian `requestUrl` in the plugin (CORS-safe).
   * Defaults to a fetch-based transport for tests/Node.
   */
  transport?: HttpTransport;
  /** @deprecated Use `transport` instead. Kept for older tests. */
  fetchImpl?: typeof fetch;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export class VikunjaClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly transport: HttpTransport;
  private readonly root: string;

  constructor(options: VikunjaClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token.trim();
    this.transport =
      options.transport ??
      createFetchTransport(options.fetchImpl ?? fetch.bind(globalThis));
    this.root = apiRoot(this.baseUrl);

    if (!this.baseUrl) {
      throw new Error('Vikunja base URL is required');
    }
    if (!this.token) {
      throw new Error('Vikunja API token is required');
    }
  }

  /** Lightweight connectivity check used by settings. */
  async testConnection(): Promise<{ projectCount: number }> {
    const projects = await this.listProjects();
    return { projectCount: projects.length };
  }

  async listProjects(): Promise<VikunjaProject[]> {
    const raw = await this.requestAllPages<Record<string, unknown>>('/projects');
    return raw.map(normalizeProject).filter((project): project is VikunjaProject => project !== null);
  }

  async listProjectTasks(projectId: number): Promise<VikunjaTask[]> {
    const raw = await this.requestAllPages<Record<string, unknown>>(
      `/projects/${projectId}/tasks`,
      { expand: 'subtasks' },
    );
    return raw.map(normalizeTask).filter((task): task is VikunjaTask => task !== null);
  }

  async getTask(taskId: number): Promise<VikunjaTask> {
    const raw = await this.request<Record<string, unknown>>('GET', `/tasks/${taskId}`);
    const task = normalizeTask(raw);
    if (!task) {
      throw new VikunjaApiError('Invalid task payload', 500, raw);
    }
    return task;
  }

  async createTask(projectId: number, input: CreateTaskInput): Promise<VikunjaTask> {
    const raw = await this.request<Record<string, unknown>>('PUT', `/projects/${projectId}/tasks`, {
      title: input.title,
      description: input.description ?? '',
      done: input.done ?? false,
      start_date: toVikunjaDatePayload(input.start_date ?? null),
      end_date: toVikunjaDatePayload(input.end_date ?? null),
    });
    const task = normalizeTask(raw);
    if (!task) {
      throw new VikunjaApiError('Invalid create-task payload', 500, raw);
    }
    return task;
  }

  async updateTask(taskId: number, input: UpdateTaskInput): Promise<VikunjaTask> {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) {
      body.title = input.title;
    }
    if (input.description !== undefined) {
      body.description = input.description;
    }
    if (input.done !== undefined) {
      body.done = input.done;
    }
    if (input.start_date !== undefined) {
      body.start_date = toVikunjaDatePayload(input.start_date);
    }
    if (input.end_date !== undefined) {
      body.end_date = toVikunjaDatePayload(input.end_date);
    }

    const raw = await this.request<Record<string, unknown>>('POST', `/tasks/${taskId}`, body);
    const task = normalizeTask(raw);
    if (!task) {
      throw new VikunjaApiError('Invalid update-task payload', 500, raw);
    }
    return task;
  }

  async listLabels(): Promise<VikunjaLabel[]> {
    const raw = await this.requestAllPages<Record<string, unknown>>('/labels');
    return raw.map(normalizeLabel).filter((label): label is VikunjaLabel => label !== null);
  }

  async createLabel(title: string, hexColor = 'e8e8e8'): Promise<VikunjaLabel> {
    const raw = await this.request<Record<string, unknown>>('PUT', '/labels', {
      title,
      hex_color: hexColor,
    });
    const label = normalizeLabel(raw);
    if (!label) {
      throw new VikunjaApiError('Invalid create-label payload', 500, raw);
    }
    return label;
  }

  async addLabelToTask(taskId: number, labelId: number): Promise<void> {
    await this.request('PUT', `/tasks/${taskId}/labels`, { label_id: labelId });
  }

  async removeLabelFromTask(taskId: number, labelId: number): Promise<void> {
    await this.request('DELETE', `/tasks/${taskId}/labels/${labelId}`);
  }

  async createRelation(taskId: number, input: CreateRelationInput): Promise<void> {
    await this.request('PUT', `/tasks/${taskId}/relations`, {
      other_task_id: input.otherTaskId,
      relation_kind: input.relationKind,
    });
  }

  async deleteRelation(
    taskId: number,
    otherTaskId: number,
    relationKind: VikunjaRelationKind,
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/tasks/${taskId}/relations/${otherTaskId}/${encodeURIComponent(relationKind)}`,
    );
  }

  /** Exposed for unit tests — builds absolute request URL. */
  buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.root}${path.startsWith('/') ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async requestAllPages<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const { data, totalPages: headerPages } = await this.requestPage<T>(path, {
        ...query,
        page,
      });
      results.push(...data);
      totalPages = headerPages;
      page += 1;
    }

    return results;
  }

  private async requestPage<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<{ data: T[]; totalPages: number }> {
    const response = await this.send('GET', this.buildUrl(path, query));
    const body = parseBody(response.text);

    if (response.status < 200 || response.status >= 300) {
      throw new VikunjaApiError(
        messageFromBody(body, `Vikunja request failed (${response.status})`),
        response.status,
        body,
      );
    }

    const totalPagesHeader = response.headers['x-pagination-total-pages'];
    const totalPages = totalPagesHeader ? Number.parseInt(totalPagesHeader, 10) : 1;

    if (!Array.isArray(body)) {
      throw new VikunjaApiError('Expected a JSON array from Vikunja', response.status, body);
    }

    return {
      data: body as T[],
      totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
    };
  }

  private async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const response = await this.send(
      method,
      this.buildUrl(path),
      body === undefined ? undefined : JSON.stringify(body),
    );
    const parsed = parseBody(response.text);

    if (response.status < 200 || response.status >= 300) {
      throw new VikunjaApiError(
        messageFromBody(parsed, `Vikunja request failed (${response.status})`),
        response.status,
        parsed,
      );
    }

    return parsed as T;
  }

  private async send(method: HttpMethod, url: string, body?: string) {
    try {
      return await this.transport({
        url,
        method,
        headers: this.headers(body !== undefined),
        body,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new VikunjaApiError(
        `Network error talking to Vikunja (${method} ${url}): ${detail}`,
        0,
        detail,
      );
    }
  }

  private headers(jsonBody = false): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };
    if (jsonBody) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }
}

function normalizeProject(raw: Record<string, unknown>): VikunjaProject | null {
  const id = Number(raw.id);
  if (!Number.isFinite(id)) {
    return null;
  }
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
  };
}

function normalizeTask(raw: Record<string, unknown>): VikunjaTask | null {
  const id = Number(raw.id);
  const projectId = Number(raw.project_id);
  if (!Number.isFinite(id) || !Number.isFinite(projectId)) {
    return null;
  }

  const relatedRaw = raw.related_tasks;
  let related_tasks: VikunjaTask['related_tasks'];
  if (relatedRaw && typeof relatedRaw === 'object') {
    related_tasks = {};
    for (const [kind, tasks] of Object.entries(relatedRaw as Record<string, unknown>)) {
      if (!Array.isArray(tasks)) {
        continue;
      }
      const normalized = tasks
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(normalizeTask)
        .filter((task): task is VikunjaTask => task !== null);
      if (normalized.length > 0) {
        related_tasks[kind as VikunjaRelationKind] = normalized;
      }
    }
  }

  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    done: Boolean(raw.done),
    percent_done: normalizePercentDone(raw.percent_done),
    project_id: projectId,
    updated: typeof raw.updated === 'string' ? raw.updated : '',
    start_date: normalizeVikunjaDate(raw.start_date),
    end_date: normalizeVikunjaDate(raw.end_date),
    labels: normalizeLabels(raw.labels),
    related_tasks,
  };
}

function normalizeLabel(raw: Record<string, unknown>): VikunjaLabel | null {
  const id = Number(raw.id);
  if (!Number.isFinite(id)) {
    return null;
  }
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    hex_color: typeof raw.hex_color === 'string' ? raw.hex_color : undefined,
  };
}

function normalizeLabels(raw: unknown): VikunjaLabel[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(normalizeLabel)
    .filter((label): label is VikunjaLabel => label !== null);
}

function normalizePercentDone(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function parseBody(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
  }
  if (typeof body === 'string' && body.trim()) {
    return body;
  }
  return fallback;
}
