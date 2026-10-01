import { describe, expect, it } from 'vitest';
import { parseNoteTasks } from './parser';

const BASE = 'https://vikunja.example';

describe('parseNoteTasks', () => {
  it('parses unlinked and linked tasks with done state', () => {
    const markdown = `
- [ ] Buy milk
- [x] [Done thing](https://vikunja.example/tasks/9)
- [/] Weird status
`.trim();

    const tasks = parseNoteTasks(markdown, { vikunjaBaseUrl: BASE });
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      title: 'Buy milk',
      done: false,
      vikunjaTaskId: null,
      checkboxChar: ' ',
    });
    expect(tasks[1]).toMatchObject({
      title: 'Done thing',
      done: true,
      vikunjaTaskId: 9,
    });
    expect(tasks[2]).toMatchObject({
      title: 'Weird status',
      done: null,
      checkboxChar: '/',
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
});
