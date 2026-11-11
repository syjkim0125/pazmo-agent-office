/** The pages a browser may be sent back to after a form or a sign-in: only these exact paths, never a query or another host. */
const ALLOWED = [/^\/$/, /^\/board$/, /^\/tasks$/, /^\/me$/, /^\/team$/, /^\/mac$/, /^\/(stories|tasks|plans)\/[0-9a-f-]{36}$/];
const MAX_LENGTH = 300;

/** The path itself when it is one of the allowed pages, otherwise null. */
export function safePath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith("/") || raw.includes("//") || raw.includes("\\")) return null;
  // Control characters (and DEL) and an encoded slash, which a proxy or browser may turn into one.
  if (/[\u0000-\u001f\u007f]/.test(raw) || /%2f/i.test(raw)) return null;
  return ALLOWED.some((re) => re.test(raw)) ? raw : null;
}
