# Public API

## createSupabaseStorageAdapter

Kind: `function`
Module: `src/features/storage/adapters/createSupabaseStorageAdapter.ts`
Source: `src/features/storage/adapters/createSupabaseStorageAdapter.ts:28:1`

Create the provider-neutral storage port implemented by Supabase Storage.

### Signatures

- `(config: SupabaseStorageAdapterConfig) => StoragePort`
  - config: `SupabaseStorageAdapterConfig`
  - returns: `StoragePort`

## SupabaseStorageAdapterConfig

Kind: `type`
Module: `src/types/supabaseStorage.ts`
Source: `src/types/supabaseStorage.ts:2:1`

Configure the credentials and optional default bucket for a Supabase storage adapter.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| anonKey | property | `string` | yes |  |
| bucket | property | `string \| undefined` | no |  |
| url | property | `string` | yes |  |
