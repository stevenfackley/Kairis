/** Shared, dependency-free path helpers for the sign-in flow (safe in proxy, server, and client code). */

/** Only same-origin absolute paths are honoured as a post-sign-in destination. */
export function safeCallbackUrl(raw: string | undefined | null, fallback = "/app"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

export function signInPath(callbackUrl: string): string {
  const q = new URLSearchParams({ callbackUrl: safeCallbackUrl(callbackUrl) });
  return `/sign-in?${q}`;
}
