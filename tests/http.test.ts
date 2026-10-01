import { afterEach, expect, it, vi } from 'vitest';
import { request, HttpError } from '../src/lib/http.js';
afterEach(() => vi.unstubAllGlobals());
it('ne révèle ni corps de réponse ni paramètres dans une erreur HTTP', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-value', {status:401})));
  try {
    await request('https://example.test/auth?token=private-value');
    expect.fail('Une erreur était attendue');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect(String(e)).not.toContain('private-value');
    expect((e as HttpError).url).toBe('https://example.test/auth');
  }
});
