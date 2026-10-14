import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";

/**
 * In-page replacements for window.confirm / window.alert. Some browsers the Office runs in
 * suppress native dialogs (confirm() returns false, alert() does nothing), so actions would
 * silently cancel and errors would never be seen.
 */

export interface ConfirmOptions {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
}

export interface NotifyOptions {
  tone?: "error" | "info";
}

export interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  notify: (message: string, opts?: NotifyOptions) => void;
}

interface PendingConfirm {
  id: number;
  opts: ConfirmOptions;
  resolve: (value: boolean) => void;
}

interface Notice {
  id: number;
  message: string;
  tone: "error" | "info";
}

const INFO_NOTICE_MS = 8000;

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) {
    throw new Error("useDialog must be used inside <DialogProvider>; wrap the app (or the test render) with it.");
  }
  return api;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [queue, setQueue] = useState<PendingConfirm[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const idRef = useRef(0);
  // Source of truth for "is this confirm still unresolved"; the queue state only drives rendering.
  const pendingRef = useRef(new Map<number, PendingConfirm>());
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      idRef.current += 1;
      const entry: PendingConfirm = { id: idRef.current, opts, resolve };
      pendingRef.current.set(entry.id, entry);
      setQueue((prev) => [...prev, entry]);
    });
  }, []);

  const dismissNotice = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    setNotices((prev) => prev.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, opts?: NotifyOptions) => {
      const tone = opts?.tone === "info" ? "info" : "error";
      idRef.current += 1;
      const id = idRef.current;
      setNotices((prev) => [...prev, { id, message, tone }]);
      if (tone === "info") {
        timersRef.current.set(
          id,
          setTimeout(() => dismissNotice(id), INFO_NOTICE_MS),
        );
      }
    },
    [dismissNotice],
  );

  const settle = useCallback((id: number, value: boolean) => {
    const target = pendingRef.current.get(id);
    if (!target) return;
    // Dropping it from the ref first makes the resolution once-only (double click, click then Esc).
    pendingRef.current.delete(id);
    setQueue((prev) => prev.filter((entry) => entry.id !== id));
    target.resolve(value);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    const pending = pendingRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      // A confirm that outlives its provider can only be a cancel.
      for (const entry of pending.values()) entry.resolve(false);
      pending.clear();
    };
  }, []);

  const api = useMemo<DialogApi>(() => ({ confirm, notify }), [confirm, notify]);
  const current = queue[0];

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && (
        <ConfirmDialog
          key={current.id}
          opts={current.opts}
          okFallback={t({ ko: "확인", en: "OK" })}
          cancelFallback={t({ ko: "취소", en: "Cancel" })}
          onSettle={(value) => settle(current.id, value)}
        />
      )}
      {/* Always mounted: assistive tech only announces additions to a live region that already exists. */}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed bottom-4 right-4 z-[2310] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {notices.map((notice) => (
          <NoticeCard
            key={notice.id}
            notice={notice}
            closeLabel={t({ ko: "닫기", en: "Close" })}
            onClose={() => dismissNotice(notice.id)}
          />
        ))}
      </div>
    </DialogContext.Provider>
  );
}

function ConfirmDialog({
  opts,
  okFallback,
  cancelFallback,
  onSettle,
}: {
  opts: ConfirmOptions;
  okFallback: string;
  cancelFallback: string;
  onSettle: (value: boolean) => void;
}) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  const danger = opts.tone === "danger";

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Capture phase: a modal underneath that closes on Escape must not also close.
        event.stopPropagation();
        event.preventDefault();
        onSettleRef.current(false);
        return;
      }
      if (event.key === "Tab") {
        const first = cancelRef.current;
        const last = okRef.current;
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div
      data-testid="dialog-backdrop"
      className="fixed inset-0 z-[2300] flex items-center justify-center bg-black/60 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onSettle(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={messageId}
        className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <p id={messageId} className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-100">
          {opts.message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onSettle(false)}
            className="rounded-lg border border-slate-600 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
          >
            {opts.cancelLabel ?? cancelFallback}
          </button>
          <button
            ref={okRef}
            type="button"
            onClick={() => onSettle(true)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white transition focus:outline-none focus:ring-2 ${
              danger
                ? "bg-rose-600 hover:bg-rose-500 focus:ring-rose-400/60"
                : "bg-indigo-600 hover:bg-indigo-500 focus:ring-indigo-400/60"
            }`}
          >
            {opts.confirmLabel ?? okFallback}
          </button>
        </div>
      </div>
    </div>
  );
}

function NoticeCard({ notice, closeLabel, onClose }: { notice: Notice; closeLabel: string; onClose: () => void }) {
  const isError = notice.tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-lg ${
        isError ? "border-rose-500/50 bg-rose-950 text-rose-100" : "border-indigo-500/50 bg-slate-900 text-slate-100"
      }`}
    >
      <p className="min-w-0 flex-1 whitespace-pre-line break-words">{notice.message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="flex-shrink-0 rounded px-1 text-base leading-none opacity-70 transition hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
      >
        ×
      </button>
    </div>
  );
}
