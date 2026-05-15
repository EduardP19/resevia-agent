const profileCache = new Map<string, { data: any; expiresAt: number }>();
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

export function getCachedProfile(tenantId: string) {
  const entry = profileCache.get(tenantId);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  return null;
}

export function setCachedProfile(tenantId: string, data: any) {
  profileCache.set(tenantId, { data, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
}

export function invalidateProfileCache(tenantId: string) {
  profileCache.delete(tenantId);
}
