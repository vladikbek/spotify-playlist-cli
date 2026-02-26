export const DEFAULT_USER_SCOPES = [
  "playlist-read-private",
  "playlist-modify-public",
  "playlist-modify-private",
  "ugc-image-upload"
] as const;

export function parseScopeList(input: string | undefined): string[] {
  if (!input?.trim()) return [...DEFAULT_USER_SCOPES];
  return input
    .split(/[\s,]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!scopes || scopes.length === 0) return [];
  return [...new Set(scopes.map((x) => x.trim()).filter(Boolean))].sort();
}

export function scopesFromOAuthValue(value: string | undefined): string[] {
  if (!value) return [];
  return normalizeScopes(value.split(/[\s,]+/g));
}
