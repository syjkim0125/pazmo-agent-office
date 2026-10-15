import { useEffect, useRef, useState } from "react";
import { getOfficeRoles } from "../api";
import type { OfficeRoles } from "./officeRoles";

const sameRoles = (a: OfficeRoles | null, b: OfficeRoles) =>
  a != null && b != null && a.pm === b.pm && a.lead === b.lead && a.engineer === b.engineer && a.reviewer === b.reviewer;

const POLL_MS = 30_000;

/**
 * Which characters hold the PM/Lead/Engineer/Reviewer roles, polled every 30 seconds. Null until
 * the first success (a preview or older server without the route never gets one, so the screen
 * stays unfiltered); after that a failed poll keeps the last known roles.
 */
export function useOfficeRoles(): OfficeRoles | null {
  const [roles, setRoles] = useState<OfficeRoles | null>(null);
  const latest = useRef<OfficeRoles | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      getOfficeRoles().then(
        (next) => {
          // Skip identical polls entirely: a state update that returns the same value can still render once.
          if (!alive || !next || sameRoles(latest.current, next)) return;
          latest.current = next;
          setRoles(next);
        },
        () => undefined,
      );
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return roles;
}
