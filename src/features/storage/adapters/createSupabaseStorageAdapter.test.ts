import { expect, it } from 'bun:test';

import {
  type CreateClientCall,
  createSupabaseClientStub,
  mockSupabaseModule,
} from '../../../createSupabaseStorageAdapter.testSupport.js';

/*** Build a tested adapter with a deterministic Supabase client stub. */
async function createFixture() {
  const calls: CreateClientCall[] = [];
  const supabase = createSupabaseClientStub();
  mockSupabaseModule({ calls, supabase });
  const { createSupabaseStorageAdapter } = await import('./createSupabaseStorageAdapter.js');
  return {
    calls,
    supabase,
    adapter: createSupabaseStorageAdapter({
      url: 'https://example.supabase.co/',
      anonKey: 'anon',
      bucket: 'media',
    }),
  };
}

it('implements the four neutral storage operations without provider capability identities', async () => {
  const { adapter, supabase } = await createFixture();
  const body = new Uint8Array([1, 2, 3]);
  supabase.bucket.listResponse = {
    data: [
      {
        id: 'hero',
        name: 'hero.png',
        created_at: '2026-10-11T10:00:00.000Z',
        updated_at: null,
        metadata: { mimetype: 'image/png', size: 3, eTag: 'etag-1' },
      },
    ],
    error: null,
  };

  expect(
    adapter.upload({ storageId: 'primary', bucket: 'media', path: '/hero.png', body }),
  ).resolves.toEqual({
    ok: true,
    data: {
      asset: {
        storageId: 'primary',
        bucket: 'media',
        path: 'hero.png',
        publicUrl: 'https://cdn.example/public/media/hero.png',
      },
    },
  });
  expect(
    adapter.remove({ storageId: 'primary', bucket: 'media', path: '/hero.png' }),
  ).resolves.toEqual({ ok: true });
  expect(
    adapter.list({ storageId: 'primary', bucket: 'media', prefix: '/authoring/', limit: 2 }),
  ).resolves.toEqual({
    ok: true,
    data: {
      objects: [
        {
          storageId: 'primary',
          bucket: 'media',
          path: 'authoring/hero.png',
          contentType: 'image/png',
          sizeBytes: 3,
          createdAt: '2026-10-11T10:00:00.000Z',
          etag: 'etag-1',
        },
      ],
    },
  });
});

it('resolves public objects without changing the neutral storage identity', async () => {
  const { adapter } = await createFixture();

  expect(
    adapter.resolve({ storageId: 'primary', bucket: 'media', path: '/hero.png', access: 'public' }),
  ).resolves.toEqual({
    ok: true,
    data: {
      asset: {
        storageId: 'primary',
        bucket: 'media',
        path: 'hero.png',
        url: 'https://cdn.example/public/media/hero.png',
        access: 'public',
      },
    },
  });
});
it('uses one resolve operation for signed URLs and preserves expiry', async () => {
  const { adapter, supabase } = await createFixture();

  expect(
    adapter.resolve({
      storageId: 'primary',
      bucket: 'media',
      path: '/hero.png',
      expiresInSeconds: 600,
    }),
  ).resolves.toEqual({
    ok: true,
    data: {
      asset: {
        storageId: 'primary',
        bucket: 'media',
        path: 'hero.png',
        url: 'https://signed.example/hero.png',
        access: 'signed',
      },
    },
  });
  expect(supabase.bucket.createSignedUrlCalls).toEqual([['hero.png', 600]]);
});

it('returns configuration failures through the neutral port', async () => {
  const calls: CreateClientCall[] = [];
  const supabase = createSupabaseClientStub();
  mockSupabaseModule({ calls, supabase });
  const { createSupabaseStorageAdapter } = await import('./createSupabaseStorageAdapter.js');
  const adapter = createSupabaseStorageAdapter({ url: '', anonKey: '' });

  expect(adapter.list({ bucket: 'media' })).resolves.toEqual({
    ok: false,
    error: { code: 'invalid_config', message: 'Supabase Storage URL is required.' },
  });
  expect(calls).toEqual([]);
});
