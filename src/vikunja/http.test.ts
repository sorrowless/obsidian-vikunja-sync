import { describe, expect, it, vi } from 'vitest';
import { createObsidianRequestTransport } from './http';

describe('createObsidianRequestTransport', () => {
  it('maps requestUrl responses and forces throw:false', async () => {
    const requestUrlFn = vi.fn().mockResolvedValue({
      status: 200,
      headers: { 'X-Pagination-Total-Pages': '1' },
      text: '[{"id":1}]',
    });

    const transport = createObsidianRequestTransport(requestUrlFn);
    const response = await transport({
      url: 'https://vikunja.example/api/v1/projects',
      method: 'GET',
      headers: { Authorization: 'Bearer tok' },
    });

    expect(requestUrlFn).toHaveBeenCalledWith({
      url: 'https://vikunja.example/api/v1/projects',
      method: 'GET',
      headers: { Authorization: 'Bearer tok' },
      body: undefined,
      throw: false,
    });
    expect(response.status).toBe(200);
    expect(response.headers['x-pagination-total-pages']).toBe('1');
    expect(response.text).toBe('[{"id":1}]');
  });
});
