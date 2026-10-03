import { describe, expect, it, vi } from 'vitest';
import type { VikunjaClient } from '../vikunja/client';
import type { VikunjaTask } from '../vikunja/types';
import { syncAllMappings } from './engine';
import {
  contentHash,
  contentSnapshot,
  emptyLedger,
  ledgerEntryKey,
  makeLedgerEntry,
  mappingKey,
} from './ledger';
import { indexRemoteTasks } from './remote';
import { applyRootReplacements, renderTaskForest } from './writer';

function task(partial: Partial<VikunjaTask> & Pick<VikunjaTask, 'id' | 'title'>): VikunjaTask {
  return {
    description: '',
    done: false,
    percent_done: 0,
    project_id: 1,
    updated: '2026-01-01T00:00:00Z',
    start_date: null,
    end_date: null,
    labels: [],
    ...partial,
  };
}

function clientStub(overrides: Record<string, unknown> = {}): VikunjaClient {
  return {
    listProjectTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    createRelation: vi.fn(),
    deleteRelation: vi.fn(),
    listLabels: vi.fn().mockResolvedValue([
      { id: 101, title: 'ToDo' },
      { id: 102, title: 'Done' },
      { id: 103, title: 'In Progress' },
    ]),
    createLabel: vi.fn(),
    addLabelToTask: vi.fn().mockResolvedValue(undefined),
    removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as VikunjaClient;
}

describe('ledger hashing', () => {
  it('changes when synced fields change', () => {
    const a = contentHash(
      contentSnapshot({ title: 'A', description: '', status: 'todo', parentTaskId: null }),
    );
    const b = contentHash(
      contentSnapshot({ title: 'B', description: '', status: 'todo', parentTaskId: null }),
    );
    expect(a).not.toBe(b);
  });
});

describe('indexRemoteTasks', () => {
  it('maps nested subtasks to parents', () => {
    const map = indexRemoteTasks([
      task({
        id: 1,
        title: 'Parent',
        related_tasks: {
          subtask: [task({ id: 2, title: 'Child' })],
        },
      }),
    ]);
    expect(map.get(1)?.parentTaskId).toBeNull();
    expect(map.get(2)?.parentTaskId).toBe(1);
  });
});

describe('writer', () => {
  it('renders canonical linked blocks with description before children', () => {
    const markdown = renderTaskForest(
      [
        {
          indent: '',
          listMarker: '-',
          checkboxChar: ' ',
          title: 'Parent',
          vikunjaTaskId: 1,
          descriptionLines: ['Intro'],
          children: [
            {
              indent: '    ',
              listMarker: '-',
              checkboxChar: 'x',
              title: 'Child',
              vikunjaTaskId: 2,
              descriptionLines: [],
              children: [],
            },
          ],
        },
      ],
      'https://vikunja.example',
    );

    expect(markdown).toBe(
      [
        '- [ ] [Parent](https://vikunja.example/tasks/1)',
        '    - Intro',
        '    - [x] [Child](https://vikunja.example/tasks/2)',
      ].join('\n'),
    );
  });

  it('replaces root blocks and appends new ones', () => {
    const input = ['# Tasks', '', '- [ ] Old', '', 'Notes'].join('\n');
    const output = applyRootReplacements(input, [
      { lineIndex: 2, endLineIndex: 2, rendered: '- [ ] [Old](https://vikunja.example/tasks/9)' },
      { lineIndex: null, endLineIndex: null, rendered: '- [ ] [New](https://vikunja.example/tasks/10)' },
    ]);
    expect(output).toContain('- [ ] [Old](https://vikunja.example/tasks/9)');
    expect(output).toContain('- [ ] [New](https://vikunja.example/tasks/10)');
    expect(output.startsWith('# Tasks')).toBe(true);
  });
});

describe('syncAllMappings', () => {
  it('creates remote tasks for unlinked local items and rewrites links', async () => {
    const notes = new Map<string, string>([['Tasks.md', '- [ ] Buy milk\n']]);
    const createTask = vi.fn().mockResolvedValue(
      task({ id: 42, title: 'Buy milk', updated: '2026-02-01T00:00:00Z' }),
    );
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([]),
      createTask,
      updateTask: vi.fn(),
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn().mockResolvedValue(undefined),
      removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as VikunjaClient;

    const ledger = emptyLedger();
    const result = await syncAllMappings([{ notePath: 'Tasks.md', projectId: 7 }], ledger, [], {
        baseUrl: 'https://vikunja.example',
        conflictPolicy: 'prefer-obsidian',
        client,
        readNote: async (path) => notes.get(path) ?? '',
        writeNote: async (path, content) => {
          notes.set(path, content);
        },
        now: () => '2026-02-01T00:00:00Z',
      },
    );

    expect(result.mappings[0]?.counts.createdRemote).toBe(1);
    expect(result.mappings[0]?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'create-remote',
          title: 'Buy milk',
        }),
      ]),
    );
    expect(notes.get('Tasks.md')).toContain('[Buy milk](https://vikunja.example/tasks/42)');
    expect(ledger.entries[ledgerEntryKey(mappingKey('Tasks.md', 7), 42)]?.title).toBe('Buy milk');
    expect(createTask).toHaveBeenCalledWith(7, {
      title: 'Buy milk',
      description: '',
      done: false,
      start_date: null,
      end_date: null,
    });
    expect(client.addLabelToTask).toHaveBeenCalledWith(42, 101);
  });

  it('creates local tasks for brand-new remote tasks', async () => {
    const notes = new Map<string, string>([['Tasks.md', '# Inbox\n']]);
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([
        task({
          id: 99,
          title: 'Write docs',
          description: 'Cover architecture\nCover sync rules',
        }),
      ]),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn().mockResolvedValue(undefined),
      removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as VikunjaClient;

    const ledger = emptyLedger();
    await syncAllMappings([{ notePath: 'Tasks.md', projectId: 1 }], ledger, [], {
      baseUrl: 'https://vikunja.example',
      conflictPolicy: 'prefer-obsidian',
      client,
      readNote: async (path) => notes.get(path) ?? '',
      writeNote: async (path, content) => {
        notes.set(path, content);
      },
    });

    const content = notes.get('Tasks.md') ?? '';
    expect(content).toContain('[Write docs](https://vikunja.example/tasks/99)');
    expect(content).toContain('Cover architecture');
    expect(content).toContain('Cover sync rules');
  });

  it('pushes local changes when remote matches ledger', async () => {
    const key = mappingKey('Tasks.md', 1);
    const ledger = emptyLedger();
    ledger.entries[ledgerEntryKey(key, 5)] = makeLedgerEntry({
      taskId: 5,
      mappingKey: key,
      title: 'A',
      description: '',
      status: 'todo',
      parentTaskId: null,
      vikunjaUpdated: '2026-01-01T00:00:00Z',
    });

    const notes = new Map<string, string>([
      ['Tasks.md', '- [ ] [B](https://vikunja.example/tasks/5)\n'],
    ]);
    const updateTask = vi.fn().mockResolvedValue(
      task({ id: 5, title: 'B', updated: '2026-03-01T00:00:00Z' }),
    );
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([
        task({ id: 5, title: 'A', updated: '2026-01-01T00:00:00Z' }),
      ]),
      createTask: vi.fn(),
      updateTask,
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn().mockResolvedValue(undefined),
      removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as VikunjaClient;

    const result = await syncAllMappings([{ notePath: 'Tasks.md', projectId: 1 }], ledger, [], {
      baseUrl: 'https://vikunja.example',
      conflictPolicy: 'prefer-obsidian',
      client,
      readNote: async (path) => notes.get(path) ?? '',
      writeNote: async (path, content) => {
        notes.set(path, content);
      },
    });

    expect(result.mappings[0]?.counts.pushed).toBe(1);
    expect(updateTask).toHaveBeenCalledWith(5, {
      title: 'B',
      description: '',
      done: false,
      start_date: null,
      end_date: null,
    });
  });

  it('pulls remote changes when local matches ledger', async () => {
    const key = mappingKey('Tasks.md', 1);
    const ledger = emptyLedger();
    ledger.entries[ledgerEntryKey(key, 5)] = makeLedgerEntry({
      taskId: 5,
      mappingKey: key,
      title: 'A',
      description: '',
      status: 'todo',
      parentTaskId: null,
      vikunjaUpdated: '2026-01-01T00:00:00Z',
    });

    const notes = new Map<string, string>([
      ['Tasks.md', '- [ ] [A](https://vikunja.example/tasks/5)\n'],
    ]);
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([
        task({ id: 5, title: 'C', updated: '2026-03-01T00:00:00Z' }),
      ]),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn().mockResolvedValue(undefined),
      removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as VikunjaClient;

    const result = await syncAllMappings([{ notePath: 'Tasks.md', projectId: 1 }], ledger, [], {
      baseUrl: 'https://vikunja.example',
      conflictPolicy: 'prefer-obsidian',
      client,
      readNote: async (path) => notes.get(path) ?? '',
      writeNote: async (path, content) => {
        notes.set(path, content);
      },
    });

    expect(result.mappings[0]?.counts.pulled).toBe(1);
    expect(notes.get('Tasks.md')).toContain('[C](https://vikunja.example/tasks/5)');
  });

  it('resolves conflicts with prefer-obsidian by pushing', async () => {
    const key = mappingKey('Tasks.md', 1);
    const ledger = emptyLedger();
    ledger.entries[ledgerEntryKey(key, 5)] = makeLedgerEntry({
      taskId: 5,
      mappingKey: key,
      title: 'A',
      description: '',
      status: 'todo',
      parentTaskId: null,
      vikunjaUpdated: '2026-01-01T00:00:00Z',
    });

    const notes = new Map<string, string>([
      ['Tasks.md', '- [ ] [B](https://vikunja.example/tasks/5)\n'],
    ]);
    const updateTask = vi.fn().mockResolvedValue(
      task({ id: 5, title: 'B', updated: '2026-03-01T00:00:00Z' }),
    );
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([
        task({ id: 5, title: 'C', updated: '2026-02-01T00:00:00Z' }),
      ]),
      createTask: vi.fn(),
      updateTask,
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn().mockResolvedValue(undefined),
      removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as VikunjaClient;

    const result = await syncAllMappings([{ notePath: 'Tasks.md', projectId: 1 }], ledger, [], {
      baseUrl: 'https://vikunja.example',
      conflictPolicy: 'prefer-obsidian',
      client,
      readNote: async (path) => notes.get(path) ?? '',
      writeNote: async (path, content) => {
        notes.set(path, content);
      },
    });

    expect(result.mappings[0]?.counts.conflictsResolved).toBe(1);
    expect(updateTask).toHaveBeenCalled();
  });

  it('reports unresolved removals without recreating', async () => {
    const key = mappingKey('Tasks.md', 1);
    const ledger = emptyLedger();
    ledger.entries[ledgerEntryKey(key, 7)] = makeLedgerEntry({
      taskId: 7,
      mappingKey: key,
      title: 'Gone remote',
      description: '',
      status: 'todo',
      parentTaskId: null,
      vikunjaUpdated: '2026-01-01T00:00:00Z',
    });

    const notes = new Map<string, string>([
      ['Tasks.md', '- [ ] [Gone remote](https://vikunja.example/tasks/7)\n'],
    ]);
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([]),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn().mockResolvedValue(undefined),
      removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as VikunjaClient;

    const result = await syncAllMappings([{ notePath: 'Tasks.md', projectId: 1 }], ledger, [], {
      baseUrl: 'https://vikunja.example',
      conflictPolicy: 'prefer-obsidian',
      client,
      readNote: async (path) => notes.get(path) ?? '',
      writeNote: async (path, content) => {
        notes.set(path, content);
      },
    });

    expect(result.mappings[0]?.counts.unresolvedRemovals).toBe(1);
    expect(result.mappings[0]?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unresolved-missing-remote',
          title: 'Gone remote',
          taskId: 7,
        }),
      ]),
    );
    expect(client.createTask).not.toHaveBeenCalled();
    expect(notes.get('Tasks.md')).toContain('tasks/7');
    expect(ledger.entries[ledgerEntryKey(key, 7)]?.unresolved).toBe(true);
  });

  it('creates nested remote child with subtask relation', async () => {
    const notes = new Map<string, string>([
      [
        'Tasks.md',
        [
          '- [ ] [Parent](https://vikunja.example/tasks/1)',
          '    - [ ] Child idea',
          '',
        ].join('\n'),
      ],
    ]);
    const createTask = vi.fn().mockResolvedValue(
      task({ id: 2, title: 'Child idea', updated: '2026-02-01T00:00:00Z' }),
    );
    const createRelation = vi.fn().mockResolvedValue(undefined);
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([task({ id: 1, title: 'Parent' })]),
      createTask,
      updateTask: vi.fn(),
      createRelation,
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn().mockResolvedValue(undefined),
      removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as VikunjaClient;

    const ledger = emptyLedger();
    // Seed parent as already synced so it is unchanged.
    const key = mappingKey('Tasks.md', 1);
    ledger.entries[ledgerEntryKey(key, 1)] = makeLedgerEntry({
      taskId: 1,
      mappingKey: key,
      title: 'Parent',
      description: '',
      status: 'todo',
      parentTaskId: null,
      vikunjaUpdated: '2026-01-01T00:00:00Z',
    });

    await syncAllMappings([{ notePath: 'Tasks.md', projectId: 1 }], ledger, [], {
      baseUrl: 'https://vikunja.example',
      conflictPolicy: 'prefer-obsidian',
      client,
      readNote: async (path) => notes.get(path) ?? '',
      writeNote: async (path, content) => {
        notes.set(path, content);
      },
    });

    expect(createTask).toHaveBeenCalled();
    expect(createRelation).toHaveBeenCalledWith(2, {
      otherTaskId: 1,
      relationKind: 'subtask',
    });
    expect(notes.get('Tasks.md')).toContain('[Child idea](https://vikunja.example/tasks/2)');
  });

  it('keeps pending links when note write fails and recovers on the next run', async () => {
    const notes = new Map<string, string>([['Tasks.md', '- [ ] Buy milk\n']]);
    const createTask = vi.fn().mockResolvedValue(
      task({ id: 42, title: 'Buy milk', updated: '2026-02-01T00:00:00Z' }),
    );
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([]),
      createTask,
      updateTask: vi.fn(),
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn().mockResolvedValue(undefined),
      removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as VikunjaClient;

    const ledger = emptyLedger();
    const pending: import('./ledger').PendingLink[] = [];

    const failed = await syncAllMappings(
      [{ notePath: 'Tasks.md', projectId: 7 }],
      ledger,
      pending,
      {
        baseUrl: 'https://vikunja.example',
        conflictPolicy: 'prefer-obsidian',
        client,
        readNote: async (path) => notes.get(path) ?? '',
        writeNote: async () => {
          throw new Error('disk full');
        },
      },
    );

    expect(failed.mappings[0]?.errors[0]).toContain('Write note failed');
    expect(Object.keys(ledger.entries)).toHaveLength(0);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.taskId).toBe(42);
    expect(notes.get('Tasks.md')).toBe('- [ ] Buy milk\n');

    const recovered = await syncAllMappings(
      [{ notePath: 'Tasks.md', projectId: 7 }],
      ledger,
      pending,
      {
        baseUrl: 'https://vikunja.example',
        conflictPolicy: 'prefer-obsidian',
        client,
        readNote: async (path) => notes.get(path) ?? '',
        writeNote: async (path, content) => {
          notes.set(path, content);
        },
      },
    );

    expect(recovered.mappings[0]?.counts.recoveredPendingLinks).toBe(1);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(notes.get('Tasks.md')).toContain('tasks/42');
    expect(pending).toHaveLength(0);
    expect(ledger.entries[ledgerEntryKey(mappingKey('Tasks.md', 7), 42)]).toBeTruthy();
  });

  it('dry-run does not write notes, ledger, or call createTask', async () => {
    const notes = new Map<string, string>([['Tasks.md', '- [ ] Buy milk\n']]);
    const createTask = vi.fn();
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([]),
      createTask,
      updateTask: vi.fn(),
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn().mockResolvedValue(undefined),
      removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as VikunjaClient;

    const ledger = emptyLedger();
    const result = await syncAllMappings(
      [{ notePath: 'Tasks.md', projectId: 7 }],
      ledger,
      [],
      {
        baseUrl: 'https://vikunja.example',
        conflictPolicy: 'prefer-obsidian',
        client,
        dryRun: true,
        readNote: async (path) => notes.get(path) ?? '',
        writeNote: async () => {
          throw new Error('should not write');
        },
      },
    );

    expect(result.dryRun).toBe(true);
    expect(result.message).toContain('Vikunja Sync dry-run');
    expect(result.message).toContain('1 would create in Vikunja');
    expect(result.mappings[0]?.counts.createdRemote).toBe(1);
    expect(result.mappings[0]?.actions).toEqual([
      expect.objectContaining({ kind: 'create-remote', title: 'Buy milk' }),
    ]);
    expect(createTask).not.toHaveBeenCalled();
    expect(Object.keys(ledger.entries)).toHaveLength(0);
    expect(notes.get('Tasks.md')).toBe('- [ ] Buy milk\n');
  });

  it('pushes start/end dates without treating the task as a new create', async () => {
    const key = mappingKey('Tasks.md', 1);
    const ledger = emptyLedger();
    ledger.entries[ledgerEntryKey(key, 5)] = makeLedgerEntry({
      taskId: 5,
      mappingKey: key,
      title: 'Meeting',
      description: '',
      status: 'todo',
      parentTaskId: null,
      vikunjaUpdated: '2026-01-01T00:00:00Z',
    });

    const notes = new Map<string, string>([
      [
        'Tasks.md',
        '- [ ] [Meeting](https://vikunja.example/tasks/5) 🛫 2026-10-02 10:00 📅 2026-10-02 11:00\n',
      ],
    ]);
    const updateTask = vi.fn().mockResolvedValue(
      task({
        id: 5,
        title: 'Meeting',
        updated: '2026-10-02T00:00:00Z',
        start_date: '2026-10-02T07:00:00.000Z',
        end_date: '2026-10-02T08:00:00.000Z',
      }),
    );
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([task({ id: 5, title: 'Meeting' })]),
      createTask: vi.fn(),
      updateTask,
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn().mockResolvedValue(undefined),
      removeLabelFromTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as VikunjaClient;

    const result = await syncAllMappings([{ notePath: 'Tasks.md', projectId: 1 }], ledger, [], {
      baseUrl: 'https://vikunja.example',
      conflictPolicy: 'prefer-obsidian',
      client,
      readNote: async (path) => notes.get(path) ?? '',
      writeNote: async (path, content) => {
        notes.set(path, content);
      },
    });

    expect(client.createTask).not.toHaveBeenCalled();
    expect(result.mappings[0]?.counts.pushed).toBe(1);
    expect(updateTask).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        title: 'Meeting',
        start_date: expect.any(String),
        end_date: expect.any(String),
      }),
    );
    expect(notes.get('Tasks.md')).toContain('[Meeting](https://vikunja.example/tasks/5)');
    expect(notes.get('Tasks.md')).toContain('🛫');
    expect(notes.get('Tasks.md')).toContain('📅');
  });

  it('pushes in-progress [/] as In Progress label and pulls labels back', async () => {
    const key = mappingKey('Tasks.md', 1);
    const ledger = emptyLedger();
    ledger.entries[ledgerEntryKey(key, 5)] = makeLedgerEntry({
      taskId: 5,
      mappingKey: key,
      title: 'Work',
      description: '',
      status: 'todo',
      parentTaskId: null,
      vikunjaUpdated: '2026-01-01T00:00:00Z',
    });

    const notes = new Map<string, string>([
      ['Tasks.md', '- [/] [Work](https://vikunja.example/tasks/5)\n'],
    ]);
    const updateTask = vi.fn().mockResolvedValue(
      task({
        id: 5,
        title: 'Work',
        done: false,
        labels: [{ id: 101, title: 'ToDo' }],
        updated: '2026-04-01T00:00:00Z',
      }),
    );
    const removeLabelFromTask = vi.fn().mockResolvedValue(undefined);
    const addLabelToTask = vi.fn().mockResolvedValue(undefined);
    const client = {
      listProjectTasks: vi.fn().mockResolvedValue([
        task({ id: 5, title: 'Work', labels: [{ id: 101, title: 'ToDo' }] }),
      ]),
      createTask: vi.fn(),
      updateTask,
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask,
      removeLabelFromTask,
    } as unknown as VikunjaClient;

    const pushResult = await syncAllMappings(
      [{ notePath: 'Tasks.md', projectId: 1 }],
      ledger,
      [],
      {
        baseUrl: 'https://vikunja.example',
        conflictPolicy: 'prefer-obsidian',
        client,
        readNote: async (path) => notes.get(path) ?? '',
        writeNote: async (path, content) => {
          notes.set(path, content);
        },
      },
    );

    expect(pushResult.mappings[0]?.counts.pushed).toBe(1);
    expect(updateTask).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ done: false }),
    );
    expect(removeLabelFromTask).toHaveBeenCalledWith(5, 101);
    expect(addLabelToTask).toHaveBeenCalledWith(5, 103);

    const notes2 = new Map<string, string>([
      ['Tasks.md', '- [ ] [Work](https://vikunja.example/tasks/5)\n'],
    ]);
    const ledger2 = emptyLedger();
    ledger2.entries[ledgerEntryKey(key, 5)] = makeLedgerEntry({
      taskId: 5,
      mappingKey: key,
      title: 'Work',
      description: '',
      status: 'todo',
      parentTaskId: null,
      vikunjaUpdated: '2026-01-01T00:00:00Z',
    });
    const client2 = {
      listProjectTasks: vi.fn().mockResolvedValue([
        task({
          id: 5,
          title: 'Work',
          done: false,
          labels: [{ id: 103, title: 'In Progress' }],
          updated: '2026-05-01T00:00:00Z',
        }),
      ]),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
      listLabels: vi.fn().mockResolvedValue([
        { id: 101, title: 'ToDo' },
        { id: 102, title: 'Done' },
        { id: 103, title: 'In Progress' },
      ]),
      createLabel: vi.fn(),
      addLabelToTask: vi.fn(),
      removeLabelFromTask: vi.fn(),
    } as unknown as VikunjaClient;

    await syncAllMappings([{ notePath: 'Tasks.md', projectId: 1 }], ledger2, [], {
      baseUrl: 'https://vikunja.example',
      conflictPolicy: 'prefer-vikunja',
      client: client2,
      readNote: async (path) => notes2.get(path) ?? '',
      writeNote: async (path, content) => {
        notes2.set(path, content);
      },
    });

    expect(notes2.get('Tasks.md')).toContain('- [/] [Work]');
  });
});
