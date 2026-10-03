import { describe, expect, it } from 'vitest';
import { parseNoteTasks } from './parser';

const BASE = 'https://vikunja.example';

describe('parseNoteTasks', () => {
  it('parses unlinked and linked tasks with done state', () => {
    const markdown = `
- [ ] Buy milk
- [x] [Done thing](https://vikunja.example/tasks/9)
- [/] In progress thing
- [-] Cancelled thing
`.trim();

    const tasks = parseNoteTasks(markdown, { vikunjaBaseUrl: BASE });
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({
      title: 'Buy milk',
      done: false,
      status: 'todo',
      vikunjaTaskId: null,
      checkboxChar: ' ',
    });
    expect(tasks[1]).toMatchObject({
      title: 'Done thing',
      done: true,
      status: 'done',
      vikunjaTaskId: 9,
    });
    expect(tasks[2]).toMatchObject({
      title: 'In progress thing',
      done: false,
      status: 'in_progress',
      checkboxChar: '/',
      vikunjaTaskId: null,
    });
    expect(tasks[3]).toMatchObject({
      title: 'Cancelled thing',
      done: null,
      status: null,
      checkboxChar: '-',
      vikunjaTaskId: null,
    });
  });

  it('attaches description bullets and nested children', () => {
    const markdown = `
- [ ] [Ship plugin](https://vikunja.example/tasks/10)
    - Outline README
    - [ ] [Write docs](https://vikunja.example/tasks/11)
        - Cover settings
    - after child still parent desc
- [ ] Trailing root
`.trim();

    const tasks = parseNoteTasks(markdown, { vikunjaBaseUrl: BASE });
    expect(tasks).toHaveLength(2);

    const root = tasks[0];
    expect(root?.vikunjaTaskId).toBe(10);
    expect(root?.descriptionLines).toEqual([
      'Outline README',
      'after child still parent desc',
    ]);
    expect(root?.children).toHaveLength(1);
    expect(root?.children[0]).toMatchObject({
      title: 'Write docs',
      vikunjaTaskId: 11,
      descriptionLines: ['Cover settings'],
    });
    expect(tasks[1]?.title).toBe('Trailing root');
  });

  it('preserves list markers and ignores foreign links as ids', () => {
    const markdown = `* [ ] [Other](https://other.example/tasks/1)`;
    const [task] = parseNoteTasks(markdown, { vikunjaBaseUrl: BASE });
    expect(task?.listMarker).toBe('*');
    expect(task?.title).toBe('Other');
    expect(task?.vikunjaTaskId).toBeNull();
  });

  it('returns an empty list for notes without checklists', () => {
    expect(parseNoteTasks('# Hello\n\n- plain bullet', { vikunjaBaseUrl: BASE })).toEqual([]);
  });

  it('keeps the Vikunja link when start/end dates follow it', () => {
    const markdown =
      '- [ ] [Buy milk](https://vikunja.example/tasks/42) 🛫 2026-10-02 10:00 📅 2026-10-02 12:00';
    const [task] = parseNoteTasks(markdown, { vikunjaBaseUrl: BASE });
    expect(task?.title).toBe('Buy milk');
    expect(task?.vikunjaTaskId).toBe(42);
    expect(task?.startDate).toMatch(/2026-10-02/);
    expect(task?.endDate).toMatch(/2026-10-02/);
  });

  it('parses dates on unlinked tasks without putting them in the title', () => {
    const markdown = '- [ ] Call dentist 🛫 2026-10-05 📅 2026-10-06';
    const [task] = parseNoteTasks(markdown, { vikunjaBaseUrl: BASE });
    expect(task?.title).toBe('Call dentist');
    expect(task?.vikunjaTaskId).toBeNull();
    expect(task?.startDate).toBeTruthy();
    expect(task?.endDate).toBeTruthy();
  });
});
