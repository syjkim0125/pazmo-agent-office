/** The same repository regardless of scheme, credentials, letter case or a
 * trailing .git, so a hub entry matches each member's local origin. */
export function normalizeRemote(url: string): string {
  const raw = url.trim();
  let host = "",
    path = "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    host = parsed.hostname;
    path = parsed.pathname;
  } else {
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(\S+)$/.exec(raw);
    if (!scp) throw new Error("INVALID_REMOTE");
    host = scp[1];
    path = scp[2];
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (!host || path.includes("..") || !/^[\w.-]+(\/[\w.-]+)+$/.test(path))
    throw new Error("INVALID_REMOTE");
  return `${host}/${path}`.toLowerCase();
}
