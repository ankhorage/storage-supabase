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

async function expectResolved(actual: Promise<unknown>, expected: unknown) {
  await Promise.resolve().then(() => expect(actual).resolves.toEqual(expected));
}

const heroListResponse = {
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

it('implements the four neutral storage operations without provider capability identities', async () => {
  const { adapter, supabase } = await createFixture();
  const body = new Uint8Array([1, 2, 3]);
  supabase.bucket.listResponse = heroListResponse;

  await expectResolved(
    adapter.upload({ storageId: 'primary', bucket: 'media', path: '/hero.png', body }),
    {
      ok: true,
      data: {
        asset: {
          storageId: 'primary',
          bucket: 'media',
          path: 'hero.png',
          publicUrl: 'https://cdn.example/public/media/hero.png',
        },
      },
    },
  );
  await expectResolved(
    adapter.remove({ storageId: 'primary', bucket: 'media', path: '/hero.png' }),
    {
      ok: true,
    },
  );
  await expectResolved(
    adapter.list({ storageId: 'primary', bucket: 'media', prefix: '/authoring/', limit: 2 }),
    {
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
    },
  );
});

it('resolves public objects without changing the neutral storage identity', async () => {
  const { adapter } = await createFixture();

  await expectResolved(
    adapter.resolve({ storageId: 'primary', bucket: 'media', path: '/hero.png', access: 'public' }),
    {
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
    },
  );
});
it('uses one resolve operation for signed URLs and preserves expiry', async () => {
  const { adapter, supabase } = await createFixture();

  await expectResolved(
    adapter.resolve({
      storageId: 'primary',
      bucket: 'media',
      path: '/hero.png',
      expiresInSeconds: 600,
    }),
    {
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
    },
  );
  expect(supabase.bucket.createSignedUrlCalls).toEqual([['hero.png', 600]]);
});

it('returns configuration failures through the neutral port', async () => {
  const calls: CreateClientCall[] = [];
  const supabase = createSupabaseClientStub();
  mockSupabaseModule({ calls, supabase });
  const { createSupabaseStorageAdapter } = await import('./createSupabaseStorageAdapter.js');
  const adapter = createSupabaseStorageAdapter({ url: '', anonKey: '' });

  await expectResolved(adapter.list({ bucket: 'media' }), {
    ok: false,
    error: { code: 'invalid_config', message: 'Supabase Storage URL is required.' },
  });
  expect(calls).toEqual([]);
});
