import { describe, expect, it } from 'vitest';
import {
  apiRoot,
  extractTaskIdFromUrl,
  normalizeBaseUrl,
  parseMarkdownLink,
  taskPageUrl,
} from './urls';

describe('normalizeBaseUrl', () => {
  it('trims and strips trailing slashes', () => {
    expect(normalizeBaseUrl(' https://vikunja.example/ ')).toBe('https://vikunja.example');
    expect(normalizeBaseUrl('https://vikunja.example///')).toBe('https://vikunja.example');
  });
});

describe('apiRoot / taskPageUrl', () => {
  it('builds API and frontend URLs', () => {
    expect(apiRoot('https://vikunja.example/')).toBe('https://vikunja.example/api/v1');
    expect(taskPageUrl('https://vikunja.example/', 42)).toBe('https://vikunja.example/tasks/42');
  });
});

describe('extractTaskIdFromUrl', () => {
  const base = 'https://vikunja.example';

  it('extracts ids and ignores trailing slash / query / hash', () => {
    expect(extractTaskIdFromUrl('https://vikunja.example/tasks/7', base)).toBe(7);
    expect(extractTaskIdFromUrl('https://vikunja.example/tasks/7/', base)).toBe(7);
    expect(extractTaskIdFromUrl('https://vikunja.example/tasks/7?x=1#y', base)).toBe(7);
  });

  it('rejects other hosts and non-task paths', () => {
    expect(extractTaskIdFromUrl('https://other.example/tasks/7', base)).toBeNull();
    expect(extractTaskIdFromUrl('https://vikunja.example/projects/7', base)).toBeNull();
  });

  it('supports base URLs with a path prefix', () => {
    expect(
      extractTaskIdFromUrl('https://example.com/vikunja/tasks/9', 'https://example.com/vikunja'),
    ).toBe(9);
  });
});

describe('parseMarkdownLink', () => {
  it('parses a sole markdown link', () => {
    expect(parseMarkdownLink('[Buy milk](https://vikunja.example/tasks/1)')).toEqual({
      title: 'Buy milk',
      url: 'https://vikunja.example/tasks/1',
    });
  });

  it('rejects plain text or trailing content', () => {
    expect(parseMarkdownLink('Buy milk')).toBeNull();
    expect(parseMarkdownLink('[Buy milk](https://x/tasks/1) extra')).toBeNull();
  });
});
