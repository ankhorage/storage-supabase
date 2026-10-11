import type { StoragePort } from '@ankhorage/storage';
import { createClient } from '@supabase/supabase-js';

import type { SupabaseStorageAdapterConfig } from '../../../types/supabaseStorage.js';

type SupabaseClient = ReturnType<typeof createClient>;
type StorageFailure = Extract<Awaited<ReturnType<StoragePort['upload']>>, { readonly ok: false }>;
interface StorageSuccess<T> {
  readonly ok: true;
  readonly data: T;
}

interface Context {
  readonly config: Config | null;
  readonly error: StorageFailure | null;
  readonly client: SupabaseClient | null;
}

interface Config {
  readonly url: string;
  readonly anonKey: string;
  readonly bucket?: string;
}

const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 900;

/*** Create the provider-neutral storage port implemented by Supabase Storage. */
export function createSupabaseStorageAdapter(config: SupabaseStorageAdapterConfig): StoragePort {
  const context = createContext(config);
  return {
    upload: (input) => upload(context, input),
    remove: (input) => remove(context, input),
    list: (input) => list(context, input),
    resolve: (input) => resolve(context, input),
  };
}

/*** Create a provider client only after validating its private configuration. */
function createContext(input: SupabaseStorageAdapterConfig): Context {
  const config = normalizeConfig(input);
  return config.ok
    ? {
        config: config.data,
        error: null,
        client: createClient(config.data.url, config.data.anonKey, {
          auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        }),
      }
    : { config: null, error: config, client: null };
}

/*** Upload one object through the canonical storage upload operation. */
async function upload(
  context: Context,
  input: Parameters<StoragePort['upload']>[0],
): ReturnType<StoragePort['upload']> {
  const ready = readyContext(context);
  if (!ready.ok) return ready;
  const bucket = resolveBucket(ready.data.config, input.bucket);
  if (!bucket.ok) return bucket;
  const path = resolvePath(input.path);
  if (!path.ok) return path;
  try {
    const result = await ready.data.client.storage.from(bucket.data).upload(path.data, input.body, {
      contentType: input.contentType,
      upsert: input.upsert,
      cacheControl: input.cacheControl,
    });
    if (result.error) return providerError('upload', result.error);
    const publicUrl = getPublicUrl(ready.data.client, bucket.data, path.data);
    if (!publicUrl.ok) return publicUrl;
    return {
      ok: true,
      data: {
        asset: { ...identity(input.storageId, bucket.data, path.data), publicUrl: publicUrl.data },
      },
    };
  } catch (error) {
    return networkError(error);
  }
}

/*** Remove one object through the canonical storage remove operation. */
async function remove(
  context: Context,
  input: Parameters<StoragePort['remove']>[0],
): ReturnType<StoragePort['remove']> {
  const ready = readyContext(context);
  if (!ready.ok) return ready;
  const bucket = resolveBucket(ready.data.config, input.bucket);
  if (!bucket.ok) return bucket;
  const path = resolvePath(input.path);
  if (!path.ok) return path;
  try {
    const { error } = await ready.data.client.storage.from(bucket.data).remove([path.data]);
    return error === null ? { ok: true } : providerError('remove', error);
  } catch (error) {
    return networkError(error);
  }
}

/*** List object metadata through the canonical storage list operation. */
async function list(
  context: Context,
  input: Parameters<StoragePort['list']>[0],
): ReturnType<StoragePort['list']> {
  const ready = readyContext(context);
  if (!ready.ok) return ready;
  const bucket = resolveBucket(ready.data.config, input.bucket);
  if (!bucket.ok) return bucket;
  const limit = normalizeLimit(input.limit);
  if (!limit.ok) return limit;
  const offset = normalizeCursor(input.cursor);
  if (!offset.ok) return offset;
  const prefix = input.prefix?.trim().replace(/^\/+|\/+$/g, '') ?? '';
  try {
    const { data, error } = await ready.data.client.storage.from(bucket.data).list(prefix, {
      limit: limit.data,
      offset: offset.data,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) return providerError('list', error);
    const objects = data
      .map((item) => metadata(item, input.storageId, bucket.data, prefix))
      .filter((item) => item !== null);
    const nextCursor = data.length < limit.data ? undefined : String(offset.data + limit.data);
    return { ok: true, data: nextCursor === undefined ? { objects } : { objects, nextCursor } };
  } catch (error) {
    return networkError(error);
  }
}

/*** Resolve one object as a public URL or an expiring signed URL. */
async function resolve(
  context: Context,
  input: Parameters<StoragePort['resolve']>[0],
): ReturnType<StoragePort['resolve']> {
  const ready = readyContext(context);
  if (!ready.ok) return ready;
  const bucket = resolveBucket(ready.data.config, input.bucket);
  if (!bucket.ok) return bucket;
  const path = resolvePath(input.path);
  if (!path.ok) return path;
  const access = input.access ?? 'signed';
  if (access === 'public') {
    const url = getPublicUrl(ready.data.client, bucket.data, path.data);
    return url.ok
      ? {
          ok: true,
          data: {
            asset: { ...identity(input.storageId, bucket.data, path.data), url: url.data, access },
          },
        }
      : url;
  }
  const expiry = normalizeExpiry(input.expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS);
  if (!expiry.ok) return expiry;
  try {
    const result = await ready.data.client.storage
      .from(bucket.data)
      .createSignedUrl(path.data, expiry.data);
    if (result.error) return providerError('resolve', result.error);
    const url = readUrl(result, ['signedUrl', 'signedURL']);
    return url === null
      ? providerError('resolve', 'Supabase Storage returned an invalid signed URL response.')
      : {
          ok: true,
          data: { asset: { ...identity(input.storageId, bucket.data, path.data), url, access } },
        };
  } catch (error) {
    return networkError(error);
  }
}

/*** Obtain Supabase's synchronous public URL response for a stable object identity. */
function getPublicUrl(
  client: SupabaseClient,
  bucket: string,
  path: string,
): StorageSuccess<string> | StorageFailure {
  try {
    const result = client.storage.from(bucket).getPublicUrl(path);
    const url = readUrl(result, ['publicUrl', 'publicURL']);
    return url === null
      ? providerError('resolve', 'Supabase Storage returned an invalid public URL response.')
      : { ok: true, data: url };
  } catch (error) {
    return networkError(error);
  }
}

/*** Return the validated Supabase client or its previously recorded configuration failure. */
function readyContext(
  context: Context,
): StorageSuccess<{ readonly config: Config; readonly client: SupabaseClient }> | StorageFailure {
  return context.config === null || context.client === null
    ? (context.error ?? error('invalid_config', 'Supabase Storage is not configured.'))
    : { ok: true, data: { config: context.config, client: context.client } };
}

/*** Validate Supabase credentials and normalize its endpoint once. */
function normalizeConfig(
  input: SupabaseStorageAdapterConfig,
): StorageSuccess<Config> | StorageFailure {
  if (input.url.trim().length === 0)
    return error('invalid_config', 'Supabase Storage URL is required.');
  if (input.anonKey.trim().length === 0)
    return error('invalid_config', 'Supabase anon key is required.');
  try {
    const url = new URL(input.url.trim()).toString().replace(/\/+$/, '');
    return { ok: true, data: { url, anonKey: input.anonKey.trim(), bucket: input.bucket } };
  } catch (cause) {
    return error('invalid_config', 'Supabase Storage URL must be a valid URL.', cause);
  }
}

/*** Require an input bucket or use the adapter's configured default bucket. */
function resolveBucket(config: Config, bucket: string): StorageSuccess<string> | StorageFailure {
  const resolved = bucket.trim().length === 0 ? config.bucket : bucket;
  return resolved === undefined || resolved.trim().length === 0
    ? error('missing_bucket', 'Supabase Storage bucket is required.')
    : { ok: true, data: resolved };
}

/*** Normalize a non-empty object path for the Supabase API. */
function resolvePath(path: string): StorageSuccess<string> | StorageFailure {
  const normalized = path.trim().replace(/^\/+/, '');
  return normalized.length === 0
    ? error('validation_error', 'Storage path is required.')
    : { ok: true, data: normalized };
}

/*** Validate a signed URL duration in seconds. */
function normalizeExpiry(value: number): StorageSuccess<number> | StorageFailure {
  return Number.isSafeInteger(value) && value > 0
    ? { ok: true, data: value }
    : error('validation_error', 'Signed URL expiry must be a positive integer in seconds.');
}

/*** Normalize a list page size. */
function normalizeLimit(value: number | undefined): StorageSuccess<number> | StorageFailure {
  const limit = value ?? 100;
  return Number.isSafeInteger(limit) && limit > 0
    ? { ok: true, data: limit }
    : error('validation_error', 'Storage list limit must be a positive integer.');
}

/*** Decode the opaque offset cursor used by this Supabase adapter. */
function normalizeCursor(value: string | undefined): StorageSuccess<number> | StorageFailure {
  if (value === undefined) return { ok: true, data: 0 };
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset >= 0 && String(offset) === value
    ? { ok: true, data: offset }
    : error('validation_error', 'Storage list cursor is invalid.');
}

/*** Map Supabase list rows to the shared storage metadata contract. */
function metadata(value: unknown, storageId: string | undefined, bucket: string, prefix: string) {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string')
    return null;
  const details = isRecord(value.metadata) ? value.metadata : {};
  const contentType = readString(details.mimetype) ?? readString(details.contentType);
  const sizeBytes = readNumber(details.size);
  const createdAt = readString(value.created_at);
  const updatedAt = readString(value.updated_at);
  const etag = readString(details.eTag) ?? readString(details.etag);
  return {
    ...identity(storageId, bucket, prefix.length === 0 ? value.name : `${prefix}/${value.name}`),
    ...(contentType === undefined ? {} : { contentType }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(etag === undefined ? {} : { etag }),
  };
}

/*** Preserve the caller's provider-neutral storage identity. */
function identity(storageId: string | undefined, bucket: string, path: string) {
  return storageId === undefined ? { bucket, path } : { storageId, bucket, path };
}

/*** Read a non-empty URL from Supabase's response payload. */
function readUrl(value: unknown, keys: readonly string[]): string | null {
  if (!isRecord(value)) return null;
  const containers = isRecord(value.data) ? [value.data, value] : [value];
  for (const container of containers) {
    for (const key of keys) {
      const candidate = readUrlCandidate(container, key);
      if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
  }
  return null;
}

/*** Read one supported URL field without accepting arbitrary provider properties. */
function readUrlCandidate(container: Record<string, unknown>, key: string): unknown {
  if (key === 'publicUrl') return container.publicUrl;
  if (key === 'publicURL') return container.publicURL;
  if (key === 'signedUrl') return container.signedUrl;
  return key === 'signedURL' ? container.signedURL : undefined;
}

/*** Translate a Supabase provider error into the portable storage result shape. */
function providerError(operation: string, providerError: unknown): StorageFailure {
  return error(
    'provider_error',
    providerMessage(providerError) ?? 'Supabase Storage returned an error.',
    {
      operation,
      error: providerError,
    },
  );
}

/*** Preserve provider transport failures as portable storage errors. */
function networkError(cause: unknown): StorageFailure {
  return error('network_error', 'Unable to reach Supabase Storage.', cause);
}

/*** Construct one portable storage failure. */
function error(code: string, message: string, cause?: unknown): StorageFailure {
  return cause === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, cause } };
}

/*** Extract a readable message from Supabase errors. */
function providerMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (!isRecord(value)) return undefined;
  return [
    value.message,
    value.msg,
    value.error_description,
    value.error,
    value.error_code,
    value.code,
    value.statusText,
  ].find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
}

/*** Narrow unknown values to property records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/*** Read an optional non-empty metadata string. */
function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/*** Read an optional finite metadata number. */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
