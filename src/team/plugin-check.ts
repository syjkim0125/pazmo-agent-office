import { pluginReview } from "../runners/claude-plugins.ts";
import type { PluginReviewItem } from "../runners/claude-plugins.ts";

/** The longest heartbeat detail the Hub takes. */
const DETAIL_LIMIT = 200;

export type PluginCheckDeps = {
  /** The claude Office would run (from the runner discovery), or null when there is none ready. */
  claude: () => Promise<{ path: string; sha256: string } | null>;
  /** The person's allowed plugins; one that cannot be read allows nothing, as in Office's runs. */
  allowed: () => string[];
  /** claude's init event, without a model call (`readClaudeInit`); null when there is none. */
  readInit: (binary: string, home: string) => Promise<unknown | null>;
  home: string;
  now: () => number;
  /** A check with the same claude and the same list is not run again within this long. */
  everyMs: number;
};

/**
 * The heartbeat detail of the first plugin that keeps Office's claude roles from running (hub-setup-first S1, E7):
 * `claude: plugin-unlisted <source>` for one the allow command lets through, else `claude: plugin-refused <source>`;
 * null when every plugin passes or nothing could be judged.
 */
export function pluginDetail(items: PluginReviewItem[] | null): string | null {
  const blocked = items?.find((i) => i.state === "unlisted") ?? items?.find((i) => i.state === "refused");
  if (!blocked) return null;
  return `claude: plugin-${blocked.state} ${blocked.source}`.slice(0, DETAIL_LIMIT);
}

/**
 * The team Office's plugin check: starts claude up to its init (no model call) and judges its plugins as Office's runs
 * do. One answer serves while the claude binary (its sha256) and the allowed list stay the same, for `everyMs`; a
 * changed list (the allow command) is checked at once. Calls that overlap share one check.
 */
export function createPluginCheck(d: PluginCheckDeps): () => Promise<string | null> {
  let kept: { key: string; at: number; detail: string | null } | undefined;
  let flight: { key: string; answer: Promise<string | null> } | undefined;
  return async () => {
    const claude = await d.claude();
    if (!claude) return null;
    let allowed: string[];
    try {
      allowed = d.allowed();
    } catch {
      allowed = [];
    }
    const key = `${claude.sha256}\n${JSON.stringify([...allowed].sort())}`;
    if (kept && kept.key === key && d.now() - kept.at < d.everyMs) return kept.detail;
    if (flight && flight.key === key) return flight.answer;
    const answer = (async () => {
      try {
        const init = await d.readInit(claude.path, d.home);
        const detail = pluginDetail(init ? pluginReview(init, { allowed, home: d.home }) : null);
        kept = { key, at: d.now(), detail };
        return detail;
      } catch (error) {
        // A check that failed judged nothing; it is tried again after `everyMs`, not on every call.
        kept = { key, at: d.now(), detail: null };
        throw error;
      }
    })();
    const mine = { key, answer };
    flight = mine;
    try {
      return await answer;
    } finally {
      if (flight === mine) flight = undefined;
    }
  };
}
