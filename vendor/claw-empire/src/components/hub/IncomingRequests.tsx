import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { acceptHubIncoming, declineHubIncoming, isApiRequestError, type IncomingItem } from "../../api";

/** The hub/Office Korean text lives in details.message; ApiRequestError.message is only the error code. */
const errorText = (e: unknown): string =>
  isApiRequestError(e)
    ? ((e.details as { message?: string } | null)?.message ?? e.message)
    : e instanceof Error
      ? e.message
      : String(e);

/** The request is already settled on the hub: someone else took it, or it was closed or withdrawn. */
const isSettledElsewhere = (e: unknown): boolean =>
  isApiRequestError(e) &&
  (e.code === "ALREADY_ACCEPTED" ||
    e.code === "STATE" ||
    e.code === "NOT_FOUND" ||
    (e.details as { error?: string } | null)?.error === "ALREADY_ACCEPTED" ||
    (e.details as { error?: string } | null)?.error === "STATE" ||
    (e.details as { error?: string } | null)?.error === "NOT_FOUND");

const BODY_PREVIEW = 160;
const REASON_MAX = 500;

interface IncomingRequestsProps {
  items: IncomingItem[];
  /** The linked hub is a phase-1 hub: it cannot list received requests until it is updated. */
  upgradeRequired: boolean;
  /** Called after an accept/decline attempt so the board reloads the hub state. */
  onChanged: () => void;
}

type Notice = { tone: "ok" | "gone"; text: string };

export default function IncomingRequests({ items, upgradeRequired, onChanged }: IncomingRequestsProps) {
  const { t } = useI18n();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  // Synchronous guard: two clicks in the same tick must not send twice.
  const inFlight = useRef(false);

  // A result notice is a transient confirmation, not state: it clears itself.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visible = items.filter((x) => !removed.has(x.requestId));
  if (!upgradeRequired && visible.length === 0 && !notice) return null;

  const drop = (id: string) => setRemoved((prev) => new Set(prev).add(id));
  const setError = (id: string, text: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (text === null) delete next[id];
      else next[id] = text;
      return next;
    });

  async function run(x: IncomingItem, action: () => Promise<unknown>, okText: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyId(x.requestId);
    setError(x.requestId, null);
    try {
      await action();
      drop(x.requestId);
      setDecliningId((current) => (current === x.requestId ? null : current));
      setNotice({ tone: "ok", text: okText });
    } catch (e) {
      if (isSettledElsewhere(e)) {
        drop(x.requestId);
        setDecliningId((current) => (current === x.requestId ? null : current));
        setNotice({ tone: "gone", text: errorText(e) });
      } else {
        // Keep the decline box open with the typed reason so it can be retried.
        setError(x.requestId, errorText(e));
      }
    } finally {
      inFlight.current = false;
      setBusyId(null);
      onChanged();
    }
  }

  const accept = (x: IncomingItem) =>
    run(
      x,
      () => acceptHubIncoming(x.requestId),
      t({
        ko: "수락했습니다. 곧 Inbox에 작업으로 들어옵니다.",
        en: "Accepted. It will appear in the Inbox as a task shortly.",
      }),
    );
  const decline = (x: IncomingItem) =>
    run(x, () => declineHubIncoming(x.requestId, reason.trim()), t({ ko: "거절했습니다.", en: "Declined." }));

  return (
    <section
      aria-label={t({ ko: "팀 허브에서 받은 요청", en: "Requests received from the team hub" })}
      className="flex flex-col gap-2 rounded-lg border border-indigo-700 bg-slate-800/60 p-2"
    >
      <h3 className="text-xs font-semibold text-slate-300">
        {t({ ko: "받은 팀 허브 요청", en: "Incoming team hub requests" })}
        {!upgradeRequired && visible.length > 0 ? ` (${visible.length})` : ""}
      </h3>

      {upgradeRequired ? (
        <p className="text-xs text-amber-400">
          {t({
            ko: "허브를 업데이트해야 받은 요청을 볼 수 있습니다.",
            en: "The hub must be updated before received requests can be shown.",
          })}
        </p>
      ) : (
        visible.map((x) => {
          const declining = decliningId === x.requestId;
          const busy = busyId === x.requestId;
          const chars = Array.from(x.body);
          const body = chars.length > BODY_PREVIEW ? `${chars.slice(0, BODY_PREVIEW).join("")}…` : x.body;
          return (
            <div
              key={x.requestId}
              data-incoming-card
              className="rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-slate-300"
            >
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-white">{x.requester}</span>
                <span className="min-w-0 truncate text-slate-400">{x.originRepoName ?? x.source ?? ""}</span>
                {x.risk === "high" && (
                  <span className="rounded-full bg-red-900 px-2 py-0.5 text-[10px] text-red-300">
                    {t({ ko: "위험 높음", en: "High risk" })}
                  </span>
                )}
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap break-words" title={x.body}>
                {body}
              </p>

              {declining ? (
                <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-200">
                  <label className="block text-[11px]">
                    {t({ ko: "거절 사유 (선택)", en: "Reason for declining (optional)" })}
                    <textarea
                      aria-label={t({ ko: "거절 사유", en: "Decline reason" })}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={REASON_MAX}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white"
                    />
                  </label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void decline(x)}
                      disabled={busy}
                      className="flex items-center justify-center rounded-lg bg-red-800 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t({ ko: "거절", en: "Decline" })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecliningId(null)}
                      disabled={busy}
                      className="flex items-center justify-center rounded-lg bg-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:bg-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t({ ko: "취소", en: "Cancel" })}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void accept(x)}
                    disabled={!!busyId}
                    className="flex items-center justify-center rounded-lg bg-green-700 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t({ ko: "수락", en: "Accept" })}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(x.requestId, null);
                      setReason("");
                      setDecliningId(x.requestId);
                    }}
                    disabled={!!busyId}
                    className="flex items-center justify-center rounded-lg bg-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:bg-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t({ ko: "거절", en: "Decline" })}
                  </button>
                </div>
              )}
              {errors[x.requestId] && (
                <p role="alert" className="mt-1 text-red-400">
                  {errors[x.requestId]}
                </p>
              )}
            </div>
          );
        })
      )}

      {notice && (
        <p
          role={notice.tone === "ok" ? "status" : "alert"}
          className={`text-xs ${notice.tone === "ok" ? "text-emerald-400" : "text-red-400"}`}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
