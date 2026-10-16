import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { isApiRequestError, linkHub, unlinkHub, type HubStatus } from "../../api";
import { useDialog } from "../common/DialogProvider";

/** The hub/Office Korean text lives in details.message; ApiRequestError.message is only the error code. */
const errorText = (e: unknown): string =>
  isApiRequestError(e)
    ? ((e.details as { message?: string } | null)?.message ?? e.message)
    : e instanceof Error
      ? e.message
      : String(e);

const hostOf = (hub: string | null): string => {
  if (!hub) return "";
  try {
    return new URL(hub).host;
  } catch {
    return hub;
  }
};

/** The https URL a pasted text points at: the connection link itself or the --hub value of the
 * legacy command. The server does the real parsing; this only drives what the screen previews. */
const targetUrlOf = (text: string): URL | null => {
  const raw = text.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  const candidate = /(?:^|\s)--hub\s+(\S+)/.exec(raw)?.[1] ?? (/\s/.test(raw) ? "" : raw);
  try {
    const url = new URL(candidate.replace(/^["'`]+|["'`]+$/g, ""));
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

/** The hub host a pasted text points at, for showing before connecting. Host only: the
 * code and fingerprint never reach the screen. */
const targetHostOf = (text: string): string => targetUrlOf(text)?.host ?? "";

/** An invite link is for joining the hub in a browser; it is not a connection string. */
const isInviteLink = (text: string): boolean => {
  const raw = text.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (/\s/.test(raw)) return false;
  const url = targetUrlOf(raw);
  return !!url && url.pathname.startsWith("/invite/");
};

const originOf = (hub: string | null): string => {
  if (!hub) return "";
  try {
    return new URL(hub).origin;
  } catch {
    return "";
  }
};

interface HubConnectDialogProps {
  status: HubStatus;
  onClose: () => void;
  /** Called after a link or unlink succeeded, so the caller can re-read the status. */
  onChanged: () => void;
}

export default function HubConnectDialog({ status, onClose, onChanged }: HubConnectDialogProps) {
  const { t } = useI18n();
  const { confirm } = useDialog();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const host = hostOf(status.hub);
  const invite = isInviteLink(text);
  const targetHost = invite ? "" : targetHostOf(text);
  const summary = [host, status.member, status.repoName].filter(Boolean).join(" · ");

  async function connect() {
    setError("");
    setDone("");
    if (status.linked) {
      const targetOrigin = targetUrlOf(text)?.origin ?? "";
      const otherHub = !!targetOrigin && targetOrigin !== originOf(status.hub);
      const cancelWarning =
        otherHub && status.activeHubTasks > 0
          ? t({
              ko: ` 이전 허브에서 받은 진행 중 작업 ${status.activeHubTasks}건이 취소됩니다.`,
              en: ` ${status.activeHubTasks} in-progress task(s) received from the previous hub will be cancelled.`,
            })
          : "";
      const replace = await confirm({
        message:
          t({
            ko: `기존 연결(${host || "허브"})을 ${targetHost || "새 허브"} 연결로 바꿉니다. 진행 중인 보낸 요청은 먼저 정리하세요.`,
            en: `This replaces the existing link (${host || "hub"}) with a link to ${targetHost || "the new hub"}. Clean up any pending outgoing requests first.`,
          }) + cancelWarning,
        confirmLabel: t({ ko: "바꾸기", en: "Replace" }),
        cancelLabel: t({ ko: "취소", en: "Cancel" }),
      });
      if (!replace) return;
    }
    setBusy(true);
    try {
      const result = await linkHub(text);
      setText("");
      const connected = t({
        ko: `연결했습니다: ${result.member} · ${result.repoName}`,
        en: `Connected: ${result.member} · ${result.repoName}`,
      });
      const registered = result.created
        ? t({
            ko: ` 허브에 새 레포 ${result.repoName}로 등록했습니다.`,
            en: ` Registered a new repo ${result.repoName} on the hub.`,
          })
        : "";
      const cancelled =
        (result.cancelledTasks ?? 0) > 0
          ? t({
              ko: ` 이전 허브 작업 ${result.cancelledTasks}건을 취소했습니다.`,
              en: ` Cancelled ${result.cancelledTasks} task(s) from the previous hub.`,
            })
          : "";
      setDone(connected + registered + cancelled);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setError("");
    setDone("");
    const yes = await confirm({
      message:
        t({
          ko: "팀 허브 연결을 해제합니다. 다시 연결하려면 새 연결 문자열이 필요합니다.",
          en: "This unlinks the team hub. You need a new connection string to link again.",
        }) +
        (status.activeHubTasks > 0
          ? t({
              ko: ` 이 Office에는 허브에서 받은 진행 중 작업 ${status.activeHubTasks}건이 남습니다. 필요하면 직접 취소하세요.`,
              en: ` ${status.activeHubTasks} in-progress task(s) received from the hub will remain in this Office. Cancel them yourself if needed.`,
            })
          : ""),
      confirmLabel: t({ ko: "연결 해제", en: "Unlink" }),
      cancelLabel: t({ ko: "취소", en: "Cancel" }),
      tone: "danger",
    });
    if (!yes) return;
    setBusy(true);
    try {
      await unlinkHub();
      setDone(t({ ko: "연결을 해제했습니다.", en: "Unlinked." }));
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t({ ko: "팀 허브 연결", en: "Team hub connection" })}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">{t({ ko: "팀 허브 연결", en: "Team hub connection" })}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            title={t({ ko: "닫기", en: "Close" })}
            aria-label={t({ ko: "닫기", en: "Close" })}
          >
            ✕
          </button>
        </div>

        {status.linked && (
          <div className="mb-3 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{t({ ko: "현재 연결", en: "Current link" })}</p>
            <p className="break-all text-sm text-white">{summary}</p>
            {status.legacy && (
              <p className="mt-1 text-[11px] text-amber-400">
                {t({
                  ko: "허브를 업데이트해야 요청을 보낼 수 있습니다.",
                  en: "The hub needs an update before requests can be sent.",
                })}
              </p>
            )}
          </div>
        )}

        <label className="block text-xs text-slate-300">
          {t({ ko: "연결 문자열", en: "Connection string" })}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={t({
              ko: "허브의 내 Office 연결에서 복사한 문자열을 붙여넣으세요",
              en: "Paste the string copied from My Office connection in the hub",
            })}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 font-mono text-xs text-white"
          />
        </label>
        {invite && (
          <p className="mt-1 text-[11px] text-amber-400">
            {t({
              ko: "초대 링크입니다. 허브에 합류한 뒤 내 Office 연결에서 연결 문자열을 만드세요.",
              en: "This is an invite link. Join the hub, then create a connection string in My Office connection.",
            })}
          </p>
        )}
        {targetHost && (
          <p className="mt-1 text-[11px] text-slate-400">
            {t({ ko: `${targetHost}에 연결합니다.`, en: `Connects to ${targetHost}.` })}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="mt-2 text-xs text-emerald-400">
            {done}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {status.hub && (
              <a
                href={status.hub}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
              >
                {t({ ko: "허브 열기", en: "Open hub" })}
              </a>
            )}
            {status.linked && (
              <button
                onClick={() => void disconnect()}
                disabled={busy}
                className="rounded-lg bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t({ ko: "연결 해제", en: "Unlink" })}
              </button>
            )}
          </div>
          <button
            onClick={() => void connect()}
            disabled={busy || !text.trim() || invite}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {t({ ko: "연결", en: "Connect" })}
          </button>
        </div>
      </div>
    </div>
  );
}
