/*** Configure the credentials and optional default bucket for a Supabase storage adapter. */
export interface SupabaseStorageAdapterConfig {
  readonly url: string;
  readonly anonKey: string;
  readonly bucket?: string;
}
