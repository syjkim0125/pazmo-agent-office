import { useCallback, useEffect, useRef, useState } from "react";
import { getHubStatus, type HubStatus } from "../api";

const POLL_MS = 10_000;

/**
 * The Office's team-hub link state, polled every 10 seconds. `status` stays null until the
 * first successful poll (a preview without the bridge never gets one), which hides the header
 * button. After that a transient failure keeps the last known status, so an open dialog survives.
 */
export function useHubStatus(): { status: HubStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<HubStatus | null>(null);
  const alive = useRef(true);
  const load = useCallback(() => {
    getHubStatus().then(
      (next) => alive.current && setStatus(next),
      // A failed poll keeps the last known status; null only until the first success.
      () => undefined,
    );
  }, []);
  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [load]);
  return { status, refresh: load };
}
