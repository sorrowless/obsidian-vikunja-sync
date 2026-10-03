import { describe, expect, it } from 'vitest';
import {
  STATUS_LABEL_DONE,
  STATUS_LABEL_IN_PROGRESS,
  STATUS_LABEL_TODO,
  checkboxFromStatus,
  isProgressLabelTitle,
  labelTitleForStatus,
  statusFromCheckbox,
  statusFromLabels,
} from './status';

describe('status mapping via labels', () => {
  it('maps Obsidian checkboxes', () => {
    expect(statusFromCheckbox(' ')).toBe('todo');
    expect(statusFromCheckbox('x')).toBe('done');
    expect(statusFromCheckbox('X')).toBe('done');
    expect(statusFromCheckbox('/')).toBe('in_progress');
    expect(statusFromCheckbox('-')).toBeNull();
  });

  it('maps Vikunja labels to statuses', () => {
    expect(statusFromLabels([{ title: STATUS_LABEL_TODO }])).toBe('todo');
    expect(statusFromLabels([{ title: STATUS_LABEL_DONE }])).toBe('done');
    expect(statusFromLabels([{ title: STATUS_LABEL_IN_PROGRESS }])).toBe('in_progress');
    expect(statusFromLabels([{ title: 'review' }])).toBe('in_progress');
    expect(statusFromLabels([{ title: STATUS_LABEL_TODO }, { title: 'review' }])).toBe('todo');
    expect(statusFromLabels([{ title: STATUS_LABEL_DONE }, { title: STATUS_LABEL_TODO }])).toBe(
      'done',
    );
    expect(statusFromLabels([])).toBe('todo');
    expect(statusFromLabels(null)).toBe('todo');
  });

  it('round-trips status ↔ progress label titles and checkboxes', () => {
    for (const status of ['todo', 'in_progress', 'done'] as const) {
      expect(statusFromLabels([{ title: labelTitleForStatus(status) }])).toBe(status);
      expect(statusFromCheckbox(checkboxFromStatus(status))).toBe(status);
      expect(isProgressLabelTitle(labelTitleForStatus(status))).toBe(true);
    }
    expect(isProgressLabelTitle('urgent')).toBe(false);
  });
});
