import { useEffect, useRef, useCallback, useState } from "react";

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number = 3000, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const refresh = useCallback(async () => {
    try {
      const result = await fetcher();
      setData(result);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, intervalMs);

    function handleVisibility() {
      clearInterval(timerRef.current);
      if (!document.hidden) {
        refresh();
        timerRef.current = setInterval(refresh, intervalMs);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh, intervalMs]);

  return { data, loading, error, refresh };
}
