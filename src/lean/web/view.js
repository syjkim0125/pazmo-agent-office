// The lean Office screen's pure part: the string table and the display models
// app.js draws. Nothing here touches the DOM when it is imported, so node's
// test runner loads it as it is; `el` and `regionHeld` act only on what they are given.

export const STRINGS = {
  ko: {
    appName: "Pazmo Office",
    navTasks: "작업",
    navDecisions: "결정",
    navAgents: "Agent",
    navLabel: "화면",
    newTask: "새 작업",
    openDecisions: "열린 결정 {n}개",
    col_waiting: "대기",
    col_active: "진행",
    col_decide: "결정 대기",
    col_done: "완료",
    col_cancelled: "취소",
    stage_plan: "기획",
    stage_design: "설계",
    stage_build: "구현",
    stage_review: "리뷰",
    stage_g4: "최종 승인",
    stage_done: "완료",
    stage_cancelled: "취소",
    deletedAgent: "(삭제된 agent)",
    highRisk: "높은 위험",
    stopped: "멈춤",
    stoppedHint: "진행 기록을 확인하고, 다시 실행하거나 작업을 취소하세요.",
    stoppedRerunHint: "이미 다시 실행한 작업입니다. 이 작업은 취소하세요.",
    emptyColumn: "없음",
    boardEmpty: "아직 작업이 없습니다. [새 작업]으로 시작하세요.",
    loading: "불러오는 중…",
    retry: "다시 시도",
    dismiss: "알림 닫기",
    close: "닫기",
    errNetwork: "연결이 끊겼습니다. Office를 다시 켰다면 monitor 주소를 다시 여세요.",
    errFailed: "요청을 처리하지 못했습니다.",
    errStopping: "Office를 멈추는 중입니다.",
    errSession: "세션을 열 수 없습니다. Office 주소로 다시 열어 주세요.",
    errStale: "결정이 갱신되었습니다. 다시 답해 주세요.",
    errBusy: "진행 중인 작업이 있습니다.",
    errLastAgent: "마지막 agent는 삭제할 수 없습니다.",
    errRunnerNotReady: "agent 실행기를 확인하세요.",
    errNameTaken: "같은 이름의 agent가 이미 있습니다.",
    errNameInvalid: "이름은 공백을 뺀 1–40자여야 합니다.",
    errAnswerRequired: "사용자의 답변을 적어주세요.",
    errNotFound: "찾을 수 없습니다.",
    errNotStopped: "멈춘 작업만 다시 실행할 수 있습니다.",
    errAlreadyRerun: "이미 다시 실행한 작업입니다.",
    title: "제목",
    body: "내용",
    agent: "맡을 agent",
    risk: "위험도",
    riskNormal: "보통",
    riskHigh: "높음",
    create: "만들기",
    creating: "만드는 중…",
    noAgents: "agent가 없습니다. 먼저 agent를 추가하세요.",
    goAgents: "Agent 화면으로 가기",
    titleRequired: "제목을 적어 주세요.",
    titleTooLong: "제목은 200자까지 적을 수 있습니다.",
    bodyTooLong: "내용은 16384바이트까지입니다.",
    taskCreated: "작업을 만들었습니다.",
    backToBoard: "← 작업 보드",
    taskNotFound: "작업을 찾을 수 없습니다.",
    sectionBody: "내용",
    noBody: "내용 없음",
    sectionSummary: "결과 요약",
    sectionDecisions: "이 작업의 결정",
    sectionEvents: "진행 기록",
    noEvents: "아직 기록이 없습니다.",
    sectionDiffs: "변경",
    noDiffs: "아직 변경이 없습니다.",
    diffPreparing: "준비 중",
    diffUnavailable: "볼 수 없음",
    sectionRuns: "실행기 기록",
    noRuns: "아직 실행 기록이 없습니다.",
    sectionDeliveries: "인도 위치",
    noDeliveries: "아직 인도되지 않았습니다.",
    deliveryNoDirectory: "위치 없음",
    delivery_delivered: "인도됨",
    delivery_not_delivered: "아직 인도 전",
    delivery_invalid: "무효",
    cancelTask: "작업 취소",
    cancelTaskAsk: "이 작업을 취소할까요? 되돌릴 수 없습니다.",
    keep: "그대로 두기",
    taskCancelled: "작업을 취소했습니다.",
    rerun: "다시 실행",
    rerunning: "다시 실행하는 중…",
    rerunNote: "새 작업을 만든 뒤 이 작업을 취소합니다. 취소는 되돌릴 수 없습니다.",
    rerunDone: "다시 실행했습니다.",
    rerunPreviousLeft: "새 작업을 만들었지만 이전 작업을 취소하지 못했습니다. 이전 작업 화면에서 취소하세요.",
    rerunOf: "이전 작업:",
    rerunBy: "다시 실행한 작업:",
    role_pm: "PM",
    role_lead: "팀장",
    role_engineer: "엔지니어",
    role_reviewer: "리뷰어",
    decisionsTitle: "결정",
    decisionsEmpty: "지금 답할 결정이 없습니다.",
    showDetail: "원문 보기",
    note: "메모",
    answer: "답변",
    hintNote: "승인 메모를 적어 주세요(필수).",
    hintAnswer: "답을 적어 주세요(필수).",
    hintNumbered: "번호별로 답해 주세요. 예: 1. … 2. …",
    hintRetry: "다시 시작할 때 고려할 점을 적어 주세요(필수).",
    noteRequired: "답을 먼저 적어 주세요.",
    noteTooLong: "16000자까지 적을 수 있습니다.",
    rejectAsk: "이 결정을 거절하고 작업을 취소할까요? 되돌릴 수 없습니다.",
    replied: "응답을 보냈습니다.",
    sending: "보내는 중…",
    gate_story: "범위 승인",
    gate_G1: "계획 승인 (G1)",
    gate_G3: "고위험 승인 (G3)",
    gate_questions: "질문",
    gate_retry: "계획 재개",
    gate_G4: "최종 승인",
    opt_approve: "내용 확인 후 승인",
    opt_answer: "답변 제출",
    opt_retry: "계획 재개",
    opt_ack: "피드백 확인 후 승인",
    opt_reject: "취소",
    effortDefault: "기본",
    modelDefault: "기본 모델",
    agentsTitle: "Agent",
    addAgent: "Agent 추가",
    editAgent: "수정",
    deleteAgent: "삭제",
    deleteAgentAsk: "이 agent를 삭제할까요?",
    agentDeleted: "agent를 삭제했습니다.",
    agentSaved: "저장했습니다.",
    agentsEmpty: "agent가 없습니다.",
    busy: "일하는 중",
    name: "이름",
    workRunner: "작업 실행기",
    reviewRunner: "리뷰 실행기",
    workShort: "작업",
    reviewShort: "리뷰",
    cli: "CLI",
    model: "모델",
    effort: "추론 수준",
    runnersLoading: "설치된 CLI를 확인하는 중…",
    runnersNone: "쓸 수 있는 실행기가 없습니다.",
    runnersFailed: "실행기 목록을 불러오지 못했습니다.",
    unusableRunner: "{runner}: 사용할 수 없음",
    current: "지금: {value}",
    save: "저장",
    saving: "저장 중…",
    nothingChanged: "바뀐 내용이 없습니다.",
    heldUpdates: "새 내용이 있습니다 — 메모를 보내거나 비우면 새로 고칩니다.",
  },
  en: {
    appName: "Pazmo Office",
    navTasks: "Tasks",
    navDecisions: "Decisions",
    navAgents: "Agents",
    navLabel: "Screens",
    newTask: "New task",
    openDecisions: "{n} open decisions",
    col_waiting: "Waiting",
    col_active: "In progress",
    col_decide: "Needs decision",
    col_done: "Done",
    col_cancelled: "Cancelled",
    stage_plan: "Plan",
    stage_design: "Design",
    stage_build: "Build",
    stage_review: "Review",
    stage_g4: "Final approval",
    stage_done: "Done",
    stage_cancelled: "Cancelled",
    deletedAgent: "(deleted agent)",
    highRisk: "High risk",
    stopped: "Stopped",
    stoppedHint: "Check the progress log, then rerun or cancel the task.",
    stoppedRerunHint: "This task was rerun already. Cancel it.",
    emptyColumn: "Nothing here",
    boardEmpty: "No tasks yet. Start one with New task.",
    loading: "Loading…",
    retry: "Try again",
    dismiss: "Dismiss",
    close: "Close",
    errNetwork: "Connection lost. If you restarted the Office, open the monitor address again.",
    errFailed: "The request failed.",
    errStopping: "The Office is stopping.",
    errSession: "Couldn't open a session. Open the Office from its address again.",
    errStale: "The decision was renewed. Please answer it again.",
    errBusy: "This agent has work in progress.",
    errLastAgent: "The last agent can't be deleted.",
    errRunnerNotReady: "Check this agent's runners.",
    errNameTaken: "An agent with this name already exists.",
    errNameInvalid: "Names are 1–40 characters, not counting surrounding spaces.",
    errAnswerRequired: "Write your answer (numbered, when there are several questions).",
    errNotFound: "Not found.",
    errNotStopped: "Only a stopped task can be rerun.",
    errAlreadyRerun: "This task was rerun already.",
    title: "Title",
    body: "Details",
    agent: "Agent",
    risk: "Risk",
    riskNormal: "Normal",
    riskHigh: "High",
    create: "Create",
    creating: "Creating…",
    noAgents: "There are no agents. Add one first.",
    goAgents: "Go to Agents",
    titleRequired: "Write a title.",
    titleTooLong: "Titles are up to 200 characters.",
    bodyTooLong: "Details are limited to 16384 bytes.",
    taskCreated: "Task created.",
    backToBoard: "← Task board",
    taskNotFound: "Task not found.",
    sectionBody: "Details",
    noBody: "No details",
    sectionSummary: "Result summary",
    sectionDecisions: "Decisions for this task",
    sectionEvents: "Progress",
    noEvents: "Nothing recorded yet.",
    sectionDiffs: "Changes",
    noDiffs: "No changes yet.",
    diffPreparing: "Preparing",
    diffUnavailable: "Unavailable",
    sectionRuns: "Runner history",
    noRuns: "No runs yet.",
    sectionDeliveries: "Delivery",
    noDeliveries: "Not delivered yet.",
    deliveryNoDirectory: "No location",
    delivery_delivered: "Delivered",
    delivery_not_delivered: "Not delivered yet",
    delivery_invalid: "Invalid",
    cancelTask: "Cancel task",
    cancelTaskAsk: "Cancel this task? This can't be undone.",
    keep: "Keep it",
    taskCancelled: "Task cancelled.",
    rerun: "Rerun",
    rerunning: "Rerunning…",
    rerunNote: "This creates a new task and then cancels this one. The cancel can't be undone.",
    rerunDone: "Rerun started.",
    rerunPreviousLeft: "The new task was created, but the stopped task could not be cancelled. Cancel it from its page.",
    rerunOf: "Rerun of:",
    rerunBy: "Rerun as:",
    role_pm: "PM",
    role_lead: "Lead",
    role_engineer: "Engineer",
    role_reviewer: "Reviewer",
    decisionsTitle: "Decisions",
    decisionsEmpty: "Nothing needs a decision right now.",
    showDetail: "Full text",
    note: "Note",
    answer: "Answer",
    hintNote: "Write a short approval note (required).",
    hintAnswer: "Write your answer (required).",
    hintNumbered: "Answer by number, e.g. 1. … 2. …",
    hintRetry: "Say what to keep in mind when resuming (required).",
    noteRequired: "Write an answer first.",
    noteTooLong: "Up to 16000 characters.",
    rejectAsk: "Reject this decision and cancel the task? This can't be undone.",
    replied: "Answer sent.",
    sending: "Sending…",
    gate_story: "Scope approval",
    gate_G1: "Plan approval (G1)",
    gate_G3: "High-risk approval (G3)",
    gate_questions: "Questions",
    gate_retry: "Resume planning",
    gate_G4: "Final approval",
    opt_approve: "Approve",
    opt_answer: "Submit answers",
    opt_retry: "Resume planning",
    opt_ack: "Approve after reading the feedback",
    opt_reject: "Cancel",
    effortDefault: "Default",
    modelDefault: "Default model",
    agentsTitle: "Agents",
    addAgent: "Add agent",
    editAgent: "Edit",
    deleteAgent: "Delete",
    deleteAgentAsk: "Delete this agent?",
    agentDeleted: "Agent deleted.",
    agentSaved: "Saved.",
    agentsEmpty: "No agents yet.",
    busy: "Working",
    name: "Name",
    workRunner: "Work runner",
    reviewRunner: "Review runner",
    workShort: "Work",
    reviewShort: "Review",
    cli: "CLI",
    model: "Model",
    effort: "Effort",
    runnersLoading: "Checking the installed CLIs…",
    runnersNone: "No runner is ready.",
    runnersFailed: "Couldn't load the runners.",
    unusableRunner: "{runner}: unavailable",
    current: "Now: {value}",
    save: "Save",
    saving: "Saving…",
    nothingChanged: "Nothing changed.",
    heldUpdates: "New updates are waiting — send or clear your note to refresh.",
  },
};

/** "ko" when the browser's language starts with "ko", otherwise "en". */
export function langOf(language) {
  return String(language ?? "").toLowerCase().startsWith("ko") ? "ko" : "en";
}

/** The string for `key`, with `{name}` placeholders filled from `vars`. An
 * unknown key is shown as itself so a gap is visible, never a blank. */
export function t(lang, key, vars) {
  const text = (STRINGS[lang] ?? STRINGS.en)[key] ?? STRINGS.en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : whole));
}

export const COLUMNS = ["waiting", "active", "decide", "done", "cancelled"];
const STAGES = new Set(["plan", "design", "build", "review", "g4", "done", "cancelled"]);

export function stageLabel(stage, lang) {
  return STAGES.has(stage) ? t(lang, `stage_${stage}`) : String(stage ?? "");
}

/** The name of a card's or task's agent; null means it was deleted. */
export function agentName(name, lang) {
  return typeof name === "string" && name ? name : t(lang, "deletedAgent");
}

/** The board's five columns, in order, each with its cards (empty ones too). */
export function columnsView(board, lang) {
  const columns = board?.columns ?? {};
  return COLUMNS.map((key) => ({
    key,
    label: t(lang, `col_${key}`),
    cards: (Array.isArray(columns[key]) ? columns[key] : []).map((card) => ({
      id: card.id,
      title: card.title,
      agent: agentName(card.agentName, lang),
      stage: card.stage,
      stageLabel: stageLabel(card.stage, lang),
      high: card.risk === "high",
      stopped: card.stopped === true,
      href: `#/tasks/${card.id}`,
    })),
  }));
}

/** What a stopped task's detail says at its top: the engine's reason and what
 * the person can do; null when it is not stopped. `rerun`: it may be rerun
 * (not once it was, when only its cancel failed). */
export function stopView(task, lang) {
  if (task?.stopped !== true) return null;
  const rerun = !task.rerunBy;
  return {
    label: t(lang, "stopped"),
    reason: typeof task.stopReason === "string" ? task.stopReason : "",
    hint: t(lang, rerun ? "stoppedHint" : "stoppedRerunHint"),
    rerun,
  };
}

/** What the rerun dialog starts with: the stopped task's content, and its
 * agent while that still exists, else the oldest (the default) agent. */
export function rerunDraft(task, agents) {
  const oldest = [...agents].sort((a, b) => a.createdAt - b.createdAt)[0];
  const own = agents.find((a) => a.id === task?.agent?.id);
  return {
    title: typeof task?.title === "string" ? task.title : "",
    body: typeof task?.body === "string" ? task.body : "",
    risk: task?.risk === "high" ? "high" : "normal",
    agentId: (own ?? oldest)?.id ?? null,
  };
}

/** After a rerun: open the new task, and say whether the stopped one was
 * cancelled (when not, the person cancels it). */
export function afterRerun(result, lang) {
  return {
    href: `#/tasks/${result.id}`,
    text: t(lang, result.previousCancelled ? "rerunDone" : "rerunPreviousLeft"),
    kind: result.previousCancelled ? "ok" : "error",
  };
}

const GATES = {
  story: "gate_story",
  G1: "gate_G1",
  G3: "gate_G3",
  questions: "gate_questions",
  "planning-retry": "gate_retry",
  G4: "gate_G4",
};
// Where the engine's summaries switch from a readable digest to the verbatim
// documents or the JSON evidence; that part is only shown folded, as `detail`.
const FOLDS = ["\n상세 원문:\n", "\n검증과 변경 내용:\n"];
const SUMMARY_LINES = 40;
const NUMBERED = /^\s*\d+[.)]\s/;

function optionLabel(option, kind, lang) {
  if (lang === "ko") return String(option.label ?? "");
  if (option.action === "workflow_answer")
    return t(lang, kind === "questions" ? "opt_answer" : kind === "planning-retry" ? "opt_retry" : "opt_approve");
  if (option.action === "workflow_reject") return t(lang, "opt_reject");
  if (option.action === "workflow_acknowledge") return t(lang, "opt_ack");
  return String(option.label ?? "");
}

const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What a decision shows: a title (request and gate), the readable part of
 * the engine's summary, the full text for the fold, and the options. A
 * decision on a subtask (G1/G3, G4) opens and names its request (`root_id`,
 * `root_title`), the only task the screen can open; the subtask's own title
 * is secondary. Option 1 needs a note (the engine refuses it empty); 2
 * rejects and cancels; 3 (G4 with feedback) approves without one. */
export function decisionView(item, lang) {
  const kind = String(item?.decision_kind ?? "");
  const gate = GATES[kind] ? t(lang, GATES[kind]) : kind;
  const taskTitle = typeof item?.task_title === "string" ? item.task_title : "";
  const rootId = typeof item?.root_id === "string" ? item.root_id : null;
  const rootTitle = typeof item?.root_title === "string" ? item.root_title : "";
  const heading = rootTitle || taskTitle;
  const full = typeof item?.summary === "string" ? item.summary : "";
  let cut = full.length;
  for (const marker of FOLDS) {
    const at = full.indexOf(marker);
    if (at >= 0 && at < cut) cut = at;
  }
  let summary = full
    .slice(0, cut)
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const lines = summary.split("\n");
  if (lines.length > SUMMARY_LINES) summary = `${lines.slice(0, SUMMARY_LINES).join("\n")}\n…`;
  const options = (Array.isArray(item?.options) ? item.options : []).map((option) => ({
    number: option.number,
    action: option.action,
    label: optionLabel(option, kind, lang),
    needsNote: option.number === 1,
    danger: option.number === 2 || option.action === "workflow_reject",
  }));
  const needsNote = options.some((o) => o.needsNote);
  const numbered = lines.filter((line) => NUMBERED.test(line)).length;
  let noteLabel = t(lang, "note"),
    noteHint = "";
  if (needsNote) {
    if (kind === "questions" || kind === "G4") {
      noteLabel = t(lang, "answer");
      noteHint = t(lang, kind === "G4" || numbered > 1 ? "hintNumbered" : "hintAnswer");
    } else noteHint = t(lang, kind === "planning-retry" ? "hintRetry" : "hintNote");
  }
  return {
    id: item?.id,
    taskId: item?.task_id ?? null,
    rootId,
    rootTitle,
    href: rootId && TASK_ID.test(rootId) ? `#/tasks/${rootId}` : null,
    subtaskTitle: rootId && item?.task_id !== rootId && taskTitle !== rootTitle ? taskTitle : "",
    kind,
    gate,
    taskTitle,
    title: [heading, gate].filter(Boolean).join(" · "),
    summary,
    detail: full,
    needsNote,
    noteLabel,
    noteHint,
    options,
  };
}

/** "codex · gpt-5.5 · high"; an effort left to the model's default is not named. */
export function runnerLabel(choice) {
  if (!choice) return "";
  return [choice.runner, choice.model, choice.reasoning].filter(Boolean).join(" · ");
}

/** The runners an agent may use (installed, logged in, not blocked), and why
 * the others cannot be used. */
export function runnerOptions(view) {
  const runners = Array.isArray(view?.runners) ? view.runners : [];
  const ok = (r) => r.status === "ready" && r.loggedIn === true && !r.blocked;
  return {
    usable: runners.filter(ok),
    unusable: runners.filter((r) => !ok(r)).map((r) => ({ runner: r.runner, hint: r.hint ?? "" })),
  };
}

/** A runner's models; a CLI that lists none is offered its own default (null). */
export function modelChoices(runner, lang) {
  const models = Array.isArray(runner?.models) ? runner.models : [];
  if (!models.length) return [{ value: null, label: t(lang, "modelDefault") }];
  return models.map((m) => ({
    value: m.slug,
    label: m.displayName && m.displayName !== m.slug ? `${m.displayName} (${m.slug})` : m.slug,
  }));
}

/** "Default" (null: the model decides) and then the model's reasoning levels. */
export function effortChoices(model, lang) {
  const levels = Array.isArray(model?.reasoningLevels) ? model.reasoningLevels : [];
  return [
    { value: null, label: t(lang, "effortDefault") },
    ...levels.map((l) => ({ value: l.effort, label: l.description ? `${l.effort} — ${l.description}` : l.effort })),
  ];
}

/** The PATCH body for an agent edit: only the keys whose value changed. A form
 * runner part is `{runner, model, effort}`; the stored one says `reasoning`. */
export function agentPatch(agent, form) {
  const patch = {};
  if (typeof form?.name === "string" && form.name.trim() !== agent.name) patch.name = form.name.trim();
  for (const part of ["work", "review"]) {
    const next = form?.[part];
    if (!next) continue;
    const now = agent[part];
    const effort = next.effort ?? null;
    if (!now || next.runner !== now.runner || next.model !== now.model || effort !== (now.reasoning ?? null))
      patch[part] = { runner: next.runner, model: next.model, effort };
  }
  return patch;
}

const TITLE_LIMIT = 200;
/** The same rule as the server: 1–200 characters after trimming. */
export function taskTitleError(title, lang) {
  const length = Array.from(String(title ?? "").trim()).length;
  if (!length) return t(lang, "titleRequired");
  if (length > TITLE_LIMIT) return t(lang, "titleTooLong");
  return null;
}

const REQUEST_BYTES = 16384;
/** The same rule as the server: the trimmed title and the details, joined by
 * a line break as the intake reads them, are at most 16384 UTF-8 bytes. */
export function taskBodyError(title, body, lang) {
  const name = String(title ?? "").trim();
  const text = String(body ?? "");
  const bytes = new TextEncoder().encode(text ? `${name}\n${text}` : name).length;
  return bytes > REQUEST_BYTES ? t(lang, "bodyTooLong") : null;
}

// Codes whose meaning is fixed: English screens get them in English (the
// server words its messages in Korean).
const KNOWN = {
  STALE_APPROVAL: "errStale",
  AGENT_BUSY: "errBusy",
  LAST_AGENT: "errLastAgent",
  AGENT_RUNNER_NOT_READY: "errRunnerNotReady",
  AGENT_NAME_TAKEN: "errNameTaken",
  AGENT_NAME_INVALID: "errNameInvalid",
  ANSWER_REQUIRED: "errAnswerRequired",
  STOPPING: "errStopping",
  NOT_FOUND: "errNotFound",
  NOT_STOPPED: "errNotStopped",
  ALREADY_RERUN: "errAlreadyRerun",
};
// Protocol refusals: the session is gone (the server words these in English).
const SESSION = new Set(["UNAUTHORIZED", "CSRF", "ORIGIN"]);

/** What to tell the person about a failed request `{status, body}`: the
 * server's message when it sent one (status 0 means it was not reached). */
export function errorText(error, lang) {
  const status = error?.status ?? 0;
  const body = error?.body;
  const code = typeof body?.error === "string" ? body.error : "";
  if (SESSION.has(code)) return t(lang, "errSession");
  if (lang !== "ko" && KNOWN[code]) return t(lang, KNOWN[code]);
  if (typeof body?.message === "string" && body.message) return body.message;
  if (KNOWN[code]) return t(lang, KNOWN[code]);
  if (status === 0) return t(lang, "errNetwork");
  return t(lang, "errFailed");
}

/** Which screen a location hash names. */
export function routeOf(hash) {
  const path = String(hash ?? "").replace(/^#/, "");
  const task = /^\/tasks\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (task) return { screen: "task", id: task[1] };
  if (path === "/decisions") return { screen: "decisions" };
  if (path === "/agents") return { screen: "agents" };
  return { screen: "tasks" };
}

/** A diff with an error: EVIDENCE_REQUIRED means the evidence is still being
 * prepared; anything else cannot be shown. */
export function diffState(diff) {
  if (!diff?.error) return "ready";
  return diff.error === "EVIDENCE_REQUIRED" ? "preparing" : "unavailable";
}

const DELIVERIES = new Set(["delivered", "not_delivered", "invalid"]);
export function deliveryLabel(status, lang) {
  return DELIVERIES.has(status) ? t(lang, `delivery_${status}`) : String(status ?? "");
}
const ROLES = new Set(["pm", "lead", "engineer", "reviewer"]);
export function roleLabel(role, lang) {
  return ROLES.has(role) ? t(lang, `role_${role}`) : String(role ?? "");
}

/** A local date and time for an epoch-ms value; "" when there is none. */
export function formatTime(ms, lang) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

// Element properties set as properties (their attribute is only the initial state).
const PROPERTIES = new Set(["value", "checked", "selected", "disabled", "open", "hidden", "required", "readOnly", "multiple"]);
// The only attributes `el` sets (besides aria-*): anything else, such as an
// inline style, a frame document or a form target, is refused.
const ATTRIBUTES = new Set([
  "id",
  "type",
  "href",
  "src",
  "alt",
  "title",
  "name",
  "for",
  "role",
  "rows",
  "cols",
  "maxlength",
  "autocomplete",
  "spellcheck",
  "novalidate",
  "datetime",
  "tabindex",
  "lang",
  "dir",
]);
const ARIA = /^aria-[a-z]+$/;

/** A link or source must stay on this page or this origin: a `#` fragment or a
 * relative path; `data:` only for an image. Checked on the string the URL
 * parser sees (tabs and newlines dropped, leading controls trimmed,
 * backslashes read as slashes), so no scheme or other host gets through. */
function sameOrigin(tag, key, value) {
  const raw = String(value);
  const url = raw
    .replace(/[\t\n\r]/g, "")
    .replace(/^[\x00-\x20]+/, "")
    .replace(/\\/g, "/");
  if (key === "src" && tag === "img" && /^data:image\//i.test(url)) return raw;
  if (url.startsWith("#")) return raw;
  // A scheme (a colon before any / ? #), or another host (//host).
  if (/^[^/?#]*:|^\/\//.test(url)) throw new Error(`${key} value is not allowed`);
  return raw;
}

/** The only way the screen builds DOM. Strings and numbers become text nodes;
 * props set listed attributes, `className`, `dataset` and listeners (`onClick`:
 * a function). HTML strings, inline styles, string handlers, unlisted
 * attributes and links off this origin are refused. */
export function el(tag, props, children) {
  const node = globalThis.document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (/HTML/.test(key) || key === "style") throw new Error(`${key} is not allowed`);
    if (/^on/i.test(key)) {
      if (value === undefined || value === null || value === false) continue;
      if (typeof value !== "function") throw new Error(`${key} is not allowed: a handler must be a function`);
      node.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    const known = key === "className" || key === "dataset" || PROPERTIES.has(key);
    if (!known && !ATTRIBUTES.has(key) && !ARIA.test(key)) throw new Error(`${key} is not allowed`);
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = String(value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (PROPERTIES.has(key)) node[key] = value;
    else if (key === "href" || key === "src") node.setAttribute(key, sameOrigin(tag, key, value));
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  append(node, children);
  return node;
}
function append(node, child) {
  if (child === undefined || child === null || typeof child === "boolean") return;
  if (Array.isArray(child)) for (const c of child) append(node, c);
  else if (typeof child === "string" || typeof child === "number")
    node.appendChild(globalThis.document.createTextNode(String(child)));
  else node.appendChild(child);
}

const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
/** Why the 3 s poll must leave `root` as it is, or null when it may redraw:
 * "dialog" (one is open), "confirm" (an in-screen confirm shows: data-hold),
 * "typed" (a field holds text the person typed), "focus" (a field has focus),
 * "selection" (text selected inside a copyable field, data-copy, such as the
 * delivery directory; plain text elsewhere does not hold). */
export function holdReason(root, doc) {
  if (!root) return null;
  if (doc.querySelector("dialog[open]")) return "dialog";
  if (root.querySelector("[data-hold]")) return "confirm";
  for (const field of root.querySelectorAll("input, textarea"))
    if (typeof field.value === "string" && field.value !== field.defaultValue) return "typed";
  const active = doc.activeElement;
  if (active && active !== root && root.contains(active) && FIELD.test(active.tagName ?? "")) return "focus";
  const selection = doc.getSelection?.();
  if (selection && !selection.isCollapsed && selection.rangeCount > 0 && root.contains(selection.anchorNode)) {
    const node = selection.anchorNode;
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    if (element?.closest?.("[data-copy]")) return "selection";
  }
  return null;
}
export function regionHeld(root, doc) {
  return holdReason(root, doc) !== null;
}

/** What a load does with what it fetched: "draw" it, keep the "same" screen,
 * "skip" (held, or a request is in flight), or "cue" (held by a typed note:
 * say that new content waits). `force` (after an action, a new route) draws. */
export function pollStep({ force, changed, pending, reason }) {
  if (force) return "draw";
  if (!changed) return "same";
  if (pending > 0) return "skip";
  if (reason === "typed") return "cue";
  return reason ? "skip" : "draw";
}

/** After a task was created elsewhere than the board: go to the board only
 * when leaving loses nothing (a typed note, an open confirm). */
export function afterCreate(screen, held) {
  return screen === "tasks" || held ? "stay" : "navigate";
}
