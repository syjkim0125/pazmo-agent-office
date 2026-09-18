import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import * as api from "../api";

export function useUpdateStatusPolling(setUpdateStatus: Dispatch<SetStateAction<api.UpdateStatus | null>>): void {
  useEffect(() => {
    let cancelled = false;
    const refreshUpdateStatus = () => {
      api
        .getUpdateStatus()
        .then((status) => {
          if (cancelled) return;
          setUpdateStatus(status);
        })
        .catch(() => {
          // Network/offline failure should not block app UI.
        });
    };
    refreshUpdateStatus();
    const timer = setInterval(refreshUpdateStatus, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [setUpdateStatus]);
}
