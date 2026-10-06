import { useEffect, useMemo, useState } from "react";
import type { UiLanguage } from "../i18n";
import { pickLang } from "../i18n";
import type { Agent } from "../types";
import AgentAvatar, { buildSpriteMap } from "./AgentAvatar";
import MessageContent from "./MessageContent";
import WorkflowDecisionContent from "./WorkflowDecisionContent";
import type { DecisionInboxItem } from "./chat/decision-inbox";
import { formatDecisionInboxTime as formatTime, type DecisionInboxModalProps } from "./chat/decision-inbox-modal.meta";

type FollowupTarget = {
  itemId: string;
  optionNumber: number;
  action?: string;
  kind: DecisionInboxItem["kind"];
  taskId?: string | null;
  decisionKind?: string | null;
};
// "reissued": moved onto a new approval challenge; "gone": nothing to answer any more.
type FollowupNotice = "stale" | "reissued" | "gone";

const REISSUABLE_GATES = new Set(["G1", "G3", "G4"]);
const EXPIRY_WARNING_MS = 2 * 60_000;

/** Office replaces an expired approval challenge with a new request for the same task and gate. */
function findReissuedDecision(items: DecisionInboxItem[], target: FollowupTarget) {
  if (target.kind !== "workflow_gate" || !target.taskId || !REISSUABLE_GATES.has(target.decisionKind ?? "")) {
    return null;
  }
  for (const entry of items) {
    if (entry.kind !== "workflow_gate" || entry.taskId !== target.taskId) continue;
    if (entry.decisionKind !== target.decisionKind) continue;
    const option = entry.options.find((candidate) => candidate.action === target.action);
    if (option) return { item: entry, optionNumber: option.number };
  }
  return null;
}

export default function DecisionInboxModal({
  open,
  loading,
  items,
  agents,
  busyKey,
  uiLanguage,
  onClose,
  onRefresh,
  onReplyOption,
  onOpenChat,
}: DecisionInboxModalProps) {
  const t = (text: { ko: string; en: string; ja?: string; zh?: string }) => pickLang(uiLanguage, text);
  const isKorean = uiLanguage.startsWith("ko");
  const spriteMap = useMemo(() => buildSpriteMap(agents), [agents]);
  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) map.set(agent.id, agent);
    return map;
  }, [agents]);
  const [followupTarget, setFollowupTarget] = useState<FollowupTarget | null>(null);
  const [followupDraft, setFollowupDraft] = useState("");
  const [followupNotice, setFollowupNotice] = useState<FollowupNotice | null>(null);
  const [followupPending, setFollowupPending] = useState(false);
  const [optionStale, setOptionStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const hasDeadline = open && items.some((entry) => entry.expiresAt);

  useEffect(() => {
    if (!hasDeadline) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [hasDeadline]);
  const [reviewPickSelections, setReviewPickSelections] = useState<Record<string, number[]>>({});
  const [reviewPickDrafts, setReviewPickDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setFollowupTarget(null);
      setFollowupDraft("");
      setFollowupNotice(null);
      setOptionStale(false);
      setReviewPickSelections({});
      setReviewPickDrafts({});
      return;
    }
    // While a reply is in flight its outcome decides; a vanished item may be our own success.
    if (!followupTarget || followupPending) return;
    if (items.some((entry) => entry.id === followupTarget.itemId)) return;
    const reissued = findReissuedDecision(items, followupTarget);
    if (reissued) {
      setFollowupTarget({ ...followupTarget, itemId: reissued.item.id, optionNumber: reissued.optionNumber });
      setFollowupNotice("reissued");
      return;
    }
    if (followupNotice) {
      // The human's answer was never applied, so keep it readable instead of dropping it.
      if (followupNotice !== "gone") setFollowupNotice("gone");
      return;
    }
    setFollowupTarget(null);
    setFollowupDraft("");
  }, [open, followupTarget, followupPending, followupNotice, items]);

  useEffect(() => {
    setReviewPickSelections((prev) => {
      const keep = new Set(items.map((item) => item.id));
      const next: Record<string, number[]> = {};
      let changed = false;
      for (const [itemId, nums] of Object.entries(prev)) {
        if (!keep.has(itemId)) {
          changed = true;
          continue;
        }
        next[itemId] = nums;
      }
      return changed ? next : prev;
    });
    setReviewPickDrafts((prev) => {
      const keep = new Set(items.map((item) => item.id));
      const next: Record<string, string> = {};
      let changed = false;
      for (const [itemId, draft] of Object.entries(prev)) {
        if (!keep.has(itemId)) {
          changed = true;
          continue;
        }
        next[itemId] = draft;
      }
      return changed ? next : prev;
    });
  }, [items]);

  const followupItem = useMemo(
    () => (followupTarget ? (items.find((entry) => entry.id === followupTarget.itemId) ?? null) : null),
    [followupTarget, items],
  );
  const followupBusyKey = followupTarget ? `${followupTarget.itemId}:${followupTarget.optionNumber}` : null;
  const isFollowupSubmitting = followupPending || (followupBusyKey ? busyKey === followupBusyKey : false);
  const canSubmitFollowup = !!(followupItem && followupDraft.trim() && !isFollowupSubmitting);

  async function handleOptionClick(item: DecisionInboxItem, optionNumber: number, action?: string) {
    if (action === "add_followup_request" || action === "workflow_answer") {
      setFollowupTarget({
        itemId: item.id,
        optionNumber,
        action,
        kind: item.kind,
        taskId: item.taskId,
        decisionKind: item.decisionKind,
      });
      setFollowupDraft("");
      setFollowupNotice(null);
      return;
    }
    setOptionStale(false);
    if ((await onReplyOption(item, optionNumber)) === "stale") setOptionStale(true);
  }

  async function handleSubmitFollowup() {
    if (!followupItem || !followupTarget || isFollowupSubmitting) return;
    const note = followupDraft.trim();
    if (!note) return;
    setFollowupPending(true);
    let outcome: Awaited<ReturnType<typeof onReplyOption>>;
    try {
      outcome = await onReplyOption(followupItem, followupTarget.optionNumber, { note });
    } finally {
      setFollowupPending(false);
    }
    if (outcome === "sent") {
      setFollowupTarget(null);
      setFollowupDraft("");
      setFollowupNotice(null);
    } else if (outcome === "stale") {
      setFollowupNotice("stale");
    }
    // Otherwise keep the human draft on rejection or uncertain delivery. The items
    // effect clears it only after the server no longer lists this request.
  }

  function handleCancelFollowup() {
    setFollowupTarget(null);
    setFollowupDraft("");
    setFollowupNotice(null);
  }

  const followupNoticeText = followupNotice
    ? {
        stale: t({
          ko: "승인 요청이 만료되었습니다. 적어 둔 메모는 그대로 두었습니다. 새로고침으로 새 요청을 불러온 뒤 다시 제출해 주세요.",
          en: "This approval request expired. Your note is kept. Refresh to load the new request, then submit again.",
        }),
        reissued: t({
          ko: "승인 요청이 만료되어 새 요청으로 바뀌었습니다. 위 내용을 다시 확인한 뒤 제출해 주세요. 적어 둔 메모는 그대로 두었고, 자동으로 다시 보내지 않습니다.",
          en: "This approval request expired and was replaced by a new one. Review it again, then submit. Your note is kept and is not resent automatically.",
        }),
        gone: t({
          ko: "이 요청은 더 이상 대기 중이 아닙니다. 적어 둔 메모가 필요하면 복사해 두세요.",
          en: "This request is no longer pending. Copy your note if you still need it.",
        }),
      }[followupNotice]
    : null;

  function formatDeadline(expiresAt: number) {
    const time = new Intl.DateTimeFormat(uiLanguage, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(expiresAt),
    );
    return expiresAt - now <= EXPIRY_WARNING_MS
      ? t({
          ko: `곧 만료 (${time}) · 만료되면 새 요청으로 자동 교체`,
          en: `Expires soon (${time}) · replaced by a new request when it expires`,
        })
      : t({
          ko: `${time}까지 유효 · 만료되면 새 요청으로 자동 교체`,
          en: `Valid until ${time} · replaced by a new request when it expires`,
        });
  }

  function getReviewPickOptions(item: DecisionInboxItem) {
    return item.options.filter((option) => option.action === "apply_review_pick");
  }

  function getReviewSkipOption(item: DecisionInboxItem) {
    return item.options.find((option) => option.action === "skip_to_next_round");
  }

  function toggleReviewPick(itemId: string, optionNumber: number) {
    setReviewPickSelections((prev) => {
      const current = prev[itemId] ?? [];
      const exists = current.includes(optionNumber);
      const nextList = exists
        ? current.filter((num) => num !== optionNumber)
        : [...current, optionNumber].sort((a, b) => a - b);
      return {
        ...prev,
        [itemId]: nextList,
      };
    });
  }

  function setReviewDraft(itemId: string, value: string) {
    setReviewPickDrafts((prev) => ({
      ...prev,
      [itemId]: value,
    }));
  }

  function clearReviewInput(itemId: string) {
    setReviewPickSelections((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    setReviewPickDrafts((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  function handleSubmitReviewPick(item: DecisionInboxItem) {
    const pickOptions = getReviewPickOptions(item);
    const selected = reviewPickSelections[item.id] ?? [];
    const extraNote = (reviewPickDrafts[item.id] ?? "").trim();
    const optionNumber = selected[0] ?? pickOptions[0]?.number;
    if (!optionNumber) return;
    if (selected.length <= 0 && !extraNote) {
      window.alert(
        t({
          ko: "최소 1개 선택하거나 추가 의견을 입력해 주세요.",
          en: "Pick at least one option or enter an extra note.",
          ja: "少なくとも1件を選択するか、追加意見を入力してください。",
          zh: "请至少选择一项或输入补充意见。",
        }),
      );
      return;
    }
    onReplyOption(item, optionNumber, {
      selected_option_numbers: selected,
      ...(extraNote ? { note: extraNote } : {}),
    });
    clearReviewInput(item.id);
  }

  function handleSkipReviewRound(item: DecisionInboxItem) {
    const skipOption = getReviewSkipOption(item);
    if (!skipOption) return;
    clearReviewInput(item.id);
    onReplyOption(item, skipOption.number);
  }

  const getKindLabel = (kind: DecisionInboxItem["kind"]) => {
    if (kind === "workflow_gate") return "작업 확인 및 승인";
    if (kind === "project_review_ready") {
      return t({ ko: "프로젝트 의사결정", en: "Project Decision", ja: "プロジェクト判断", zh: "项目决策" });
    }
    if (kind === "task_timeout_resume") {
      return t({ ko: "중단 작업 재개", en: "Timeout Resume", ja: "中断タスク再開", zh: "超时任务续跑" });
    }
    if (kind === "review_round_pick") {
      return t({
        ko: "리뷰 라운드 의사결정",
        en: "Review Round Decision",
        ja: "レビューラウンド判断",
        zh: "评审轮次决策",
      });
    }
    return t({ ko: "에이전트 요청", en: "Agent Request", ja: "エージェント要請", zh: "代理请求" });
  };
  const getKindAvatarFallback = (kind: DecisionInboxItem["kind"]) => {
    if (kind === "project_review_ready") return "🧑‍💼";
    if (kind === "task_timeout_resume") return "⏱️";
    if (kind === "review_round_pick") return "🧾";
    return "🤖";
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative mx-4 w-full max-w-3xl rounded-2xl border border-indigo-500/30 bg-slate-900 shadow-2xl shadow-indigo-500/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧭</span>
            <h2 className="text-lg font-bold text-white">
              {t({ ko: "미결 의사결정", en: "Pending Decisions", ja: "未決の意思決定", zh: "待处理决策" })}
            </h2>
            <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
              {items.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
            >
              {t({ ko: "새로고침", en: "Refresh", ja: "更新", zh: "刷新" })}
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {optionStale ? (
            <p
              role="status"
              className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200"
            >
              {t({
                ko: "요청이 만료되어 새 요청으로 바뀌었습니다. 내용을 다시 확인한 뒤 선택해 주세요. 선택은 자동으로 다시 보내지 않습니다.",
                en: "This request expired and was replaced. Review it again, then choose. Your choice is not resent automatically.",
              })}
            </p>
          ) : null}
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">
              {t({
                ko: "미결 목록 불러오는 중...",
                en: "Loading pending decisions...",
                ja: "未決一覧を読み込み中...",
                zh: "正在加载待处理决策...",
              })}
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              {t({
                ko: "현재 미결 의사결정이 없습니다.",
                en: "No pending decisions right now.",
                ja: "現在、未決の意思決定はありません。",
                zh: "当前没有待处理决策。",
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    {(() => {
                      const agent = item.agentId ? agentById.get(item.agentId) : undefined;
                      return (
                        <div className="flex min-w-0 items-start gap-2">
                          {agent ? (
                            <AgentAvatar
                              agent={agent}
                              spriteMap={spriteMap}
                              size={32}
                              className="mt-0.5 border border-slate-600 bg-slate-900"
                            />
                          ) : (
                            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-base">
                              {item.agentAvatar || getKindAvatarFallback(item.kind)}
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">
                              {isKorean ? item.agentNameKo : item.agentName}
                            </p>
                            <p className="text-[11px] text-indigo-300/90">{getKindLabel(item.kind)}</p>
                            <p className="text-[11px] text-slate-400">{formatTime(item.createdAt, uiLanguage)}</p>
                            {item.expiresAt ? (
                              <p
                                className={`text-[11px] ${item.expiresAt - now <= EXPIRY_WARNING_MS ? "text-amber-300" : "text-slate-500"}`}
                              >
                                {formatDeadline(item.expiresAt)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })()}
                    {item.agentId ? (
                      <button
                        onClick={() => onOpenChat(item.agentId!)}
                        className="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-400 hover:bg-slate-700 hover:text-white"
                      >
                        {t({ ko: "채팅 열기", en: "Open Chat", ja: "チャットを開く", zh: "打开聊天" })}
                      </button>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-2.5 py-2 text-xs text-slate-200">
                    {item.kind === "workflow_gate" ? (
                      <WorkflowDecisionContent content={item.requestContent} />
                    ) : (
                      <MessageContent content={item.requestContent} />
                    )}
                  </div>

                  <div className="mt-2 space-y-1.5">
                    {item.kind === "review_round_pick" ? (
                      (() => {
                        if (item.options.length === 0) {
                          return (
                            <p className="rounded-md border border-slate-700/70 bg-slate-900/50 px-2.5 py-2 text-xs text-slate-400">
                              {t({
                                ko: "기획팀장 의견 취합중...",
                                en: "Planning lead is consolidating opinions...",
                                ja: "企画リードが意見を集約中...",
                                zh: "规划负责人正在汇总意见...",
                              })}
                            </p>
                          );
                        }
                        const pickOptions = getReviewPickOptions(item);
                        const skipOption = getReviewSkipOption(item);
                        const selected = reviewPickSelections[item.id] ?? [];
                        const selectedCount = selected.length;
                        const draft = reviewPickDrafts[item.id] ?? "";
                        const isItemBusy = Boolean(busyKey?.startsWith(`${item.id}:`));
                        return (
                          <div className="space-y-2">
                            {pickOptions.map((option) => {
                              const selectedFlag = selected.includes(option.number);
                              return (
                                <button
                                  key={`${item.id}:${option.number}`}
                                  type="button"
                                  onClick={() => toggleReviewPick(item.id, option.number)}
                                  disabled={isItemBusy}
                                  className={`decision-inbox-option w-full rounded-md px-2.5 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-60${selectedFlag ? " decision-inbox-option-active" : ""}`}
                                >
                                  {`${option.number}. ${option.label}`}
                                </button>
                              );
                            })}
                            <p className="text-[11px] text-slate-400">
                              {t({
                                ko: `선택 항목: ${selectedCount}건`,
                                en: `Selected: ${selectedCount} item(s)`,
                                ja: `選択項目: ${selectedCount}件`,
                                zh: `已选项: ${selectedCount} 项`,
                              })}
                            </p>
                            <textarea
                              value={draft}
                              onChange={(event) => setReviewDraft(item.id, event.target.value)}
                              rows={2}
                              placeholder={t({
                                ko: "추가 의견이 있으면 입력해 주세요. (선택)",
                                en: "Enter extra notes if needed. (Optional)",
                                ja: "追加意見があれば入力してください。（任意）",
                                zh: "如有补充意见请填写。（可选）",
                              })}
                              className="w-full resize-y rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
                            />
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {skipOption ? (
                                <button
                                  type="button"
                                  onClick={() => handleSkipReviewRound(item)}
                                  disabled={isItemBusy}
                                  className="decision-round-skip rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isItemBusy
                                    ? t({ ko: "전송 중...", en: "Sending...", ja: "送信中...", zh: "发送中..." })
                                    : `${skipOption.number}. ${skipOption.label}`}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => handleSubmitReviewPick(item)}
                                disabled={isItemBusy}
                                className="decision-round-submit rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isItemBusy
                                  ? t({ ko: "전송 중...", en: "Sending...", ja: "送信中...", zh: "发送中..." })
                                  : t({
                                      ko: "선택 항목 진행",
                                      en: "Run Selected",
                                      ja: "選択項目で進行",
                                      zh: "按所选项执行",
                                    })}
                              </button>
                            </div>
                          </div>
                        );
                      })()
                    ) : item.options.length > 0 ? (
                      item.options.map((option) => {
                        const key = `${item.id}:${option.number}`;
                        const isBusy = busyKey === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleOptionClick(item, option.number, option.action)}
                            disabled={isBusy}
                            className="decision-inbox-option w-full rounded-md px-2.5 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isBusy
                              ? t({ ko: "전송 중...", en: "Sending...", ja: "送信中...", zh: "发送中..." })
                              : `${option.number}. ${option.label}`}
                          </button>
                        );
                      })
                    ) : (
                      <p className="rounded-md border border-slate-700/70 bg-slate-900/50 px-2.5 py-2 text-xs text-slate-400">
                        {item.kind === "project_review_ready"
                          ? t({
                              ko: "기획팀장 의견 취합중...",
                              en: "Planning lead is consolidating opinions...",
                              ja: "企画リードが意見を集約中...",
                              zh: "规划负责人正在汇总意见...",
                            })
                          : t({
                              ko: "선택지 준비 중...",
                              en: "Options are being prepared...",
                              ja: "選択肢を準備中...",
                              zh: "正在准备选项...",
                            })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {followupTarget && (followupItem || followupNotice === "gone") ? (
          <div className="border-t border-slate-700/60 bg-slate-900/90 px-4 py-3">
            {followupNoticeText ? (
              <p
                role="status"
                className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200"
              >
                {followupNoticeText}
              </p>
            ) : null}
            <p className="mb-2 text-xs font-semibold text-slate-200">
              {followupTarget.kind === "workflow_gate"
                ? "위 내용을 확인하고 답변을 적어주세요"
                : t({
                    ko: "추가요청사항 입력",
                    en: "Additional Follow-up Request",
                    ja: "追加要請内容の入力",
                    zh: "输入追加请求事项",
                  })}
            </p>
            <textarea
              value={followupDraft}
              onChange={(event) => setFollowupDraft(event.target.value)}
              placeholder={
                followupItem?.kind === "workflow_gate" && followupItem.requestContent.startsWith("최종 결과 승인\n")
                  ? "1. 사용자가 겪는 변화\n2. 지켜야 할 규칙과 실패 시 동작\n3. 확인한 검사와 아직 확인하지 못한 범위"
                  : t({
                      ko: "요청사항을 입력해 주세요.",
                      en: "Enter your request details.",
                      ja: "要請内容を入力してください。",
                      zh: "请输入请求详情。",
                    })
              }
              rows={3}
              className="w-full resize-y rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelFollowup}
                disabled={isFollowupSubmitting}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
              </button>
              <button
                type="button"
                onClick={handleSubmitFollowup}
                disabled={!canSubmitFollowup}
                className="decision-followup-submit rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isFollowupSubmitting
                  ? t({ ko: "전송 중...", en: "Sending...", ja: "送信中...", zh: "发送中..." })
                  : followupTarget.kind === "workflow_gate"
                    ? t({ ko: "답변 제출", en: "Submit Answer", ja: "回答を送信", zh: "提交回答" })
                    : t({ ko: "요청 등록", en: "Submit Request", ja: "要請登録", zh: "提交请求" })}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
