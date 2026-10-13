import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { getHubRepos, isApiRequestError, sendHubRequest, type HubRepo } from "../../api";

/** The hub/Office Korean text lives in details.message; ApiRequestError.message is only the error code. */
const errorText = (e: unknown): string =>
  isApiRequestError(e)
    ? ((e.details as { message?: string } | null)?.message ?? e.message)
    : e instanceof Error
      ? e.message
      : String(e);

export const HUB_REQUEST_BYTES = 16384;
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
/** A v4 UUID even where crypto.randomUUID is missing (older browsers, some test DOMs). */
export function newWindowKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface SendToHubModalProps {
  taskId: string | null;
  taskTitle?: string;
  onClose: () => void;
  onSent?: () => void;
}

export default function SendToHubModal({ taskId, taskTitle, onClose, onSent }: SendToHubModalProps) {
  const { t } = useI18n();
  // One key per window: a resend after a lost reply cannot create a second request.
  const key = useMemo(() => newWindowKey(), []);
  const [repos, setRepos] = useState<HubRepo[] | null>(null);
  const [repoId, setRepoId] = useState("");
  const [body, setBody] = useState("");
  const [risk, setRisk] = useState<"normal" | "high">("normal");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ repo: string; url: string } | null>(null);

  useEffect(() => {
    getHubRepos()
      .then((r) => {
        setRepos(r.repos);
        setRepoId(r.repos[0]?.id ?? "");
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const bytes = utf8Bytes(body.trim());
  const canSend = !!repoId && bytes > 0 && bytes <= HUB_REQUEST_BYTES && !sending && !sent;
  async function submit() {
    setSending(true);
    setError("");
    try {
      const result = await sendHubRequest({ repoId, body, risk, key, taskId });
      setSent({ repo: repos?.find((r) => r.id === repoId)?.name ?? "", url: result.url });
      onSent?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">{t({ ko: "팀 허브로 보내기", en: "Send to team hub" })}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            title={t({ ko: "닫기", en: "Close" })}
          >
            ✕
          </button>
        </div>
        {taskTitle && (
          <p className="mb-3 text-xs text-slate-400">
            {t({ ko: "출처 작업", en: "From task" })}: {taskTitle}
          </p>
        )}
        {sent ? (
          <p className="text-sm text-emerald-300">
            {t({ ko: `${sent.repo}에 요청을 올렸습니다.`, en: `Request posted to ${sent.repo}.` })}{" "}
            <a className="underline" href={sent.url} target="_blank" rel="noreferrer">
              {t({ ko: "허브에서 보기", en: "Open in hub" })}
            </a>
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs text-slate-300">
              {t({ ko: "대상 레포", en: "Repository" })}
              <select
                value={repoId}
                onChange={(e) => setRepoId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
              >
                {(repos ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.owners.join(", ")})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-300">
              {t({ ko: "요청 내용", en: "Request" })}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <p className={`text-right text-[11px] ${bytes > HUB_REQUEST_BYTES ? "text-red-400" : "text-slate-500"}`}>
              {bytes} / {HUB_REQUEST_BYTES}바이트
            </p>
            <label className="block text-xs text-slate-300">
              {t({ ko: "위험도", en: "Risk" })}
              <select
                value={risk}
                onChange={(e) => setRisk(e.target.value as "normal" | "high")}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
              >
                <option value="normal">{t({ ko: "보통", en: "Normal" })}</option>
                <option value="high">{t({ ko: "높음 (추가 승인 필요)", en: "High (extra approval)" })}</option>
              </select>
            </label>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            {sent ? t({ ko: "닫기", en: "Close" }) : t({ ko: "취소", en: "Cancel" })}
          </button>
          {!sent && (
            <button
              onClick={() => void submit()}
              disabled={!canSend}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {t({ ko: "보내기", en: "Send" })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
