import { describe, expect, it, vi } from 'vitest';
import { VikunjaClient } from './client';

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

describe('VikunjaClient request shaping', () => {
  it('sends Bearer auth and lists projects across pages', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{ id: 1, title: 'Inbox' }], {
          headers: { 'x-pagination-total-pages': '2' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: 2, title: 'Work' }], {
          headers: { 'x-pagination-total-pages': '2' },
        }),
      );

    const client = new VikunjaClient({
      baseUrl: 'https://vikunja.example/',
      token: 'secret-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const projects = await client.listProjects();
    expect(projects).toEqual([
      { id: 1, title: 'Inbox' },
      { id: 2, title: 'Work' },
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstUrl = String(fetchImpl.mock.calls[0]?.[0]);
    const firstInit = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(firstUrl).toBe('https://vikunja.example/api/v1/projects?page=1');
    expect(firstInit.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      Accept: 'application/json',
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      'https://vikunja.example/api/v1/projects?page=2',
    );
  });

  it('creates tasks with PUT and updates with POST', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 10,
          title: 'New',
          description: 'Body',
          done: false,
          project_id: 3,
          updated: '2026-01-01T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 10,
          title: 'Updated',
          description: 'Body',
          done: true,
          project_id: 3,
          updated: '2026-01-02T00:00:00Z',
        }),
      );

    const client = new VikunjaClient({
      baseUrl: 'https://vikunja.example',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const created = await client.createTask(3, {
      title: 'New',
      description: 'Body',
      done: false,
    });
    expect(created.id).toBe(10);

    const createCall = fetchImpl.mock.calls[0];
    expect(createCall?.[1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(String((createCall?.[1] as RequestInit).body))).toEqual({
      title: 'New',
      description: 'Body',
      done: false,
    });
    expect(String(createCall?.[0])).toBe('https://vikunja.example/api/v1/projects/3/tasks');

    await client.updateTask(10, { title: 'Updated', done: true });
    const updateCall = fetchImpl.mock.calls[1];
    expect(updateCall?.[1]).toMatchObject({ method: 'POST' });
    expect(String(updateCall?.[0])).toBe('https://vikunja.example/api/v1/tasks/10');
    expect(JSON.parse(String((updateCall?.[1] as RequestInit).body))).toEqual({
      title: 'Updated',
      done: true,
    });
  });

  it('creates and deletes relations with expected paths', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse(null));

    const client = new VikunjaClient({
      baseUrl: 'https://vikunja.example',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.createRelation(1, { otherTaskId: 2, relationKind: 'subtask' });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://vikunja.example/api/v1/tasks/1/relations',
    );
    expect(JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      other_task_id: 2,
      relation_kind: 'subtask',
    });

    await client.deleteRelation(1, 2, 'subtask');
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      'https://vikunja.example/api/v1/tasks/1/relations/2/subtask',
    );
    expect((fetchImpl.mock.calls[1]?.[1] as RequestInit).method).toBe('DELETE');
  });

  it('lists project tasks with expand=subtasks', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        [
          {
            id: 5,
            title: 'Parent',
            description: '',
            done: false,
            project_id: 1,
            updated: '2026-01-01T00:00:00Z',
            related_tasks: {
              subtask: [
                {
                  id: 6,
                  title: 'Child',
                  description: '',
                  done: false,
                  project_id: 1,
                  updated: '2026-01-01T00:00:00Z',
                },
              ],
            },
          },
        ],
        { headers: { 'x-pagination-total-pages': '1' } },
      ),
    );

    const client = new VikunjaClient({
      baseUrl: 'https://vikunja.example',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const tasks = await client.listProjectTasks(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('expand=subtasks');
    expect(tasks[0]?.related_tasks?.subtask?.[0]?.id).toBe(6);
  });

  it('surfaces API errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({ message: 'nope' }, { status: 401 }),
    );
    const client = new VikunjaClient({
      baseUrl: 'https://vikunja.example',
      token: 'bad',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.listProjects()).rejects.toEqual(
      expect.objectContaining({
        name: 'VikunjaApiError',
        status: 401,
        message: 'nope',
      }),
    );
  });

  it('testConnection returns project count', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse([{ id: 1, title: 'A' }, { id: 2, title: 'B' }], {
        headers: { 'x-pagination-total-pages': '1' },
      }),
    );
    const client = new VikunjaClient({
      baseUrl: 'https://vikunja.example',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.testConnection()).resolves.toEqual({ projectCount: 2 });
  });
});
