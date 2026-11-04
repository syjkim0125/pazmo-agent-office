/** Keys held at once, so a flood of distinct clients cannot grow the table without bound. */
const MAX_KEYS = 10_000;

export type RateLimit = {
  take(key: string): boolean;
  /** True while the key's window is open and used up, so its next `take` would be refused. Takes nothing and opens nothing. */
  full(key: string): boolean;
};

/**
 * A fixed window per key, in memory. `take` is true while the key has had fewer than `limit` takes since its window
 * opened; a window opens with the key's first take after the previous one ended, and a refused take does not move it.
 */
export function createRateLimit(limit: number, windowMs: number, now: () => number = Date.now): RateLimit {
  // A key is deleted before its window reopens, so insertion order is window-start order and the oldest windows come first.
  const windows = new Map<string, { start: number; count: number }>();
  const over = (start: number, at: number) => at - start >= windowMs || at < start; // a clock that stepped back ends it too
  return {
    full(key) {
      const w = windows.get(key);
      return !w || over(w.start, now()) ? limit <= 0 : w.count >= limit;
    },
    take(key) {
      const at = now();
      let w = windows.get(key);
      if (!w || over(w.start, at)) {
        windows.delete(key);
        if (windows.size >= MAX_KEYS) {
          // Windows that ended go first; if every key is still live, the oldest one makes room.
          for (const [k, v] of windows) {
            if (!over(v.start, at)) break;
            windows.delete(k);
          }
          if (windows.size >= MAX_KEYS) windows.delete(windows.keys().next().value!);
        }
        w = { start: at, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= limit) return false;
      w.count++;
      return true;
    },
  };
}
