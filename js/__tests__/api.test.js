import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({ CONFIG: { ENDPOINT_URL: 'https://example.test/exec', TOKEN: 'tok123' } }));

import { apiCall } from '../api.js';
import { setSession, clearSession } from '../session.js';

function mockFetch(body) {
  const f = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(body) }));
  globalThis.fetch = f;
  return f;
}

describe('apiCall', () => {
  beforeEach(() => clearSession());

  it('POSTs text/plain with token, empty session and payload', async () => {
    const f = mockFetch({ ok: true, data: { needsSetup: true } });
    await apiCall('bootstrapStatus', { a: 1 });
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe('https://example.test/exec');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('text/plain');
    expect(JSON.parse(opts.body)).toEqual({ action: 'bootstrapStatus', token: 'tok123', session: '', payload: { a: 1 } });
  });

  it('attaches the current session when present', async () => {
    const f = mockFetch({ ok: true, data: {} });
    setSession('sess-9', { UserID: 'U1', Name: 'A', Role: 'Admin' });
    await apiCall('listUsers');
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.session).toBe('sess-9');
    expect(body.payload).toEqual({});
  });

  it('returns data on ok:true', async () => {
    mockFetch({ ok: true, data: { x: 5 } });
    expect(await apiCall('t')).toEqual({ x: 5 });
  });

  it('throws the error string on ok:false', async () => {
    mockFetch({ ok: false, error: 'bad_login' });
    await expect(apiCall('login', {})).rejects.toThrow('bad_login');
    try { await apiCall('login', {}); } catch (e) { expect(e.code).toBe('bad_login'); }
  });
});
