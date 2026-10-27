// The lean Office screen: hash routes, the 3 s poll, dialogs and requests.
// Every node is built with `el` (text only); the display rules live in view.js.
import {
  afterCreate,
  agentName,
  agentPatch,
  columnsView,
  decisionView,
  deliveryLabel,
  diffState,
  effortChoices,
  el,
  errorText,
  formatTime,
  holdReason,
  langOf,
  modelChoices,
  pollStep,
  regionHeld,
  roleLabel,
  routeOf,
  runnerLabel,
  runnerOptions,
  stageLabel,
  stopView,
  t,
  taskBodyError,
  taskTitleError,
} from "./view.js";

const POLL_MS = 3000;
const NOTE_LIMIT = 16000;

const lang = langOf(navigator.language);
const L = (key, vars) => t(lang, key, vars);

const top = document.getElementById("top");
const notice = document.getElementById("notice");
const main = document.getElementById("main");

const state = {
  csrf: null,
  route: routeOf(location.hash),
  /** The screen and data now drawn in `main` ("!…" for a failure shown). */
  drawn: null,
  /** Keys of the folds the person opened, kept across redraws. */
  open: new Set(),
  /** Requests started from the screen and not yet answered. */
  pending: 0,
  seq: 0,
  /** The load in flight, if any (a poll never starts over one). */
  loadingSeq: 0,
  timer: 0,
  chain: 0,
  noticeKey: null,
  noticeText: null,
  noticeTimer: 0,
  /** The person dismissed the "new updates are waiting" cue; until the next draw. */
  cueDismissed: false,
};

let nextId = 0;
const uid = (prefix) => `${prefix}-${++nextId}`;

// --- Requests -------------------------------------------------------------

class ApiError extends Error {
  constructor(status, body) {
    super(typeof body?.message === "string" ? body.message : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const headers = method === "GET" ? {} : { "x-csrf-token": state.csrf ?? "", "content-type": "application/json" };
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, null);
  }
  const data = await res.json().catch(() => null);
  return { res, data };
}

let opening = null;
/** Opens the session (the server sets its HttpOnly cookie) and keeps the CSRF token. */
function ensureSession(renew = false) {
  if (state.csrf && !renew) return Promise.resolve();
  opening ??= (async () => {
    const { res, data } = await request("GET", "/api/session");
    if (!res.ok || typeof data?.csrf !== "string") throw new ApiError(res.status, data);
    state.csrf = data.csrf;
  })().finally(() => {
    opening = null;
  });
  return opening;
}

/** A JSON API call. A 401 opens the session again once and retries; a second
 * 401 is an error like any other. */
async function api(method, path, body) {
  await ensureSession();
  let { res, data } = await request(method, path, body);
  if (res.status === 401) {
    await ensureSession(true);
    ({ res, data } = await request(method, path, body));
  }
  if (!res.ok) {
    const error = new ApiError(res.status, data);
    if (res.status === 503 && data?.error === "STOPPING") say(errorText(error, lang), "error", "stopping");
    throw error;
  }
  return data;
}

/** Runs a request from the screen: its controls are disabled while it is in
 * flight (no double submit) and the poll leaves the screen alone meanwhile.
 * Disabling the focused control drops focus, so afterwards it goes back to
 * that control, to its redrawn successor (same data-key), or, when the
 * control is gone (an answered decision, a deleted agent), to `main`. */
async function act(controls, run, onError) {
  const focused = document.activeElement;
  for (const c of controls) c.disabled = true;
  state.pending += 1;
  try {
    await run();
    return true;
  } catch (error) {
    onError(errorText(error, lang), error);
    return false;
  } finally {
    state.pending -= 1;
    for (const c of controls) c.disabled = false;
    refocus(focused);
  }
}
function refocus(focused) {
  const now = document.activeElement;
  if (!focused || focused === document.body || (now && now !== document.body)) return;
  const key = focused.dataset?.key;
  const successor = focused.isConnected
    ? focused
    : key
      ? main.querySelector(`[data-key="${CSS.escape(key)}"]`)
      : null;
  (successor ?? main).focus({ preventScroll: true });
}

// --- Notice ---------------------------------------------------------------

/** One line under the top bar. `kind` "ok" fades by itself; errors stay. */
function say(text, kind = "ok", key = null) {
  // A repeated poll failure leaves the notice (and its focus) as it is.
  if (key && state.noticeKey === key && state.noticeText === text) return;
  clearTimeout(state.noticeTimer);
  state.noticeKey = key;
  state.noticeText = text;
  notice.className = `notice ${kind}`;
  notice.replaceChildren(
    el("p", { className: "notice-text" }, text),
    el(
      "button",
      {
        type: "button",
        className: "btn quiet",
        onClick: () => {
          if (state.noticeKey === "held") state.cueDismissed = true;
          clearNotice();
        },
      },
      L("dismiss"),
    ),
  );
  if (kind === "ok") state.noticeTimer = setTimeout(() => clearNotice(), 4000);
}
/** Clears the notice; with a key, only the notice of that key. */
function clearNotice(key) {
  if (key !== undefined && state.noticeKey !== key) return;
  clearTimeout(state.noticeTimer);
  state.noticeKey = null;
  state.noticeText = null;
  notice.className = "notice";
  notice.replaceChildren();
}

// --- Top bar --------------------------------------------------------------

const nav = { links: {}, badge: null, badgeText: null };

function buildTop() {
  nav.badge = el("span", { className: "badge", hidden: true, "aria-hidden": "true" });
  nav.badgeText = el("span", { className: "sr-only" });
  nav.links = {
    tasks: el("a", { href: "#/tasks" }, L("navTasks")),
    decisions: el("a", { href: "#/decisions" }, [L("navDecisions"), nav.badge, nav.badgeText]),
    agents: el("a", { href: "#/agents" }, L("navAgents")),
  };
  top.replaceChildren(
    el("a", { className: "brand", href: "#/tasks" }, L("appName")),
    el("nav", { className: "nav", "aria-label": L("navLabel") }, Object.values(nav.links)),
    el(
      "button",
      { type: "button", className: "btn primary new-task", onClick: (e) => openTaskDialog(e.currentTarget) },
      L("newTask"),
    ),
  );
}

function markNav() {
  const screen = state.route.screen === "task" ? "tasks" : state.route.screen;
  for (const [key, link] of Object.entries(nav.links)) {
    if (key === screen) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function setBadge(count) {
  nav.badge.textContent = String(count);
  nav.badge.hidden = count === 0;
  nav.badgeText.textContent = count ? ` (${L("openDecisions", { n: count })})` : "";
}

// --- Loading and the poll -----------------------------------------------------

function fetchScreen(route) {
  const decisions = api("GET", "/api/decisions").then((b) => (Array.isArray(b?.decisions) ? b.decisions : []));
  let data;
  if (route.screen === "task") data = api("GET", `/api/tasks/${encodeURIComponent(route.id)}`);
  else if (route.screen === "decisions") data = decisions;
  else if (route.screen === "agents") data = api("GET", "/api/agents").then((b) => (Array.isArray(b?.agents) ? b.agents : []));
  else data = api("GET", "/api/board");
  return Promise.all([data, decisions]);
}

/** Fetches the screen and redraws it when its data changed. A poll (not
 * `force`) leaves the screen as it is while it holds input (holdReason) or a
 * request is in flight, and says so when a typed note holds back new content;
 * `force` (after an action, or a new route) redraws, and keeps typed notes
 * except the one just answered (`answered`). */
async function load({ force = false, answered = null } = {}) {
  const route = state.route;
  const seq = ++state.seq;
  state.loadingSeq = seq;
  try {
    const [data, decisions] = await fetchScreen(route);
    if (seq !== state.seq) return;
    setBadge(decisions.length);
    clearNotice("poll");
    const key = `${route.screen}:${route.id ?? ""}\n${JSON.stringify(data)}`;
    const step = pollStep({
      force,
      changed: key !== state.drawn,
      pending: state.pending,
      reason: force ? null : holdReason(main, document),
    });
    if (step === "same") return clearNotice("held");
    if (step === "cue") {
      // Quiet, and never over another message.
      if (!state.cueDismissed && (!notice.hasChildNodes() || state.noticeKey === "held"))
        say(L("heldUpdates"), "info", "held");
      return;
    }
    if (step === "skip") return;
    draw(route, data, answered);
    state.drawn = key;
  } catch (error) {
    if (seq !== state.seq) return;
    if (state.drawn === null || state.drawn.startsWith("!")) drawFailure(route, error);
    else say(errorText(error, lang), "error", "poll");
  } finally {
    if (state.loadingSeq === seq) state.loadingSeq = 0;
  }
}

/** Every 3 s while the tab is visible; a hidden tab stops polling and the
 * next visibility change resumes it. */
function tick() {
  const mine = ++state.chain;
  clearTimeout(state.timer);
  if (document.visibilityState !== "visible") return;
  (state.loadingSeq ? Promise.resolve() : load()).finally(() => {
    if (mine === state.chain && document.visibilityState === "visible") state.timer = setTimeout(tick, POLL_MS);
  });
}

function navigate() {
  state.route = routeOf(location.hash);
  state.drawn = null;
  markNav();
  main.replaceChildren(el("p", { className: "state" }, L("loading")));
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
  load({ force: true });
}

// --- Drawing with what the person is doing kept --------------------------

/** What a redraw would lose: scroll offsets, the focused control, typed notes. */
function capture(root) {
  const scroll = new Map();
  for (const node of root.querySelectorAll("[data-scroll-key]"))
    scroll.set(node.dataset.scrollKey, [node.scrollLeft, node.scrollTop]);
  const active = document.activeElement;
  const hadFocus = !!active && root.contains(active);
  const focusKey = hadFocus && active !== root ? (active.dataset?.key ?? null) : null;
  const byId = new Map(),
    byKey = new Map();
  for (const field of root.querySelectorAll("textarea[data-note]"))
    if (field.value) {
      byId.set(field.dataset.note, field.value);
      byKey.set(field.dataset.noteKey, field.value);
    }
  return { scroll, focusKey, hadFocus, byId, byKey };
}

function restore(root, saved) {
  for (const node of root.querySelectorAll("[data-scroll-key]")) {
    const at = saved.scroll.get(node.dataset.scrollKey);
    if (at) [node.scrollLeft, node.scrollTop] = at;
  }
  // A renewed decision has a new id but the same task and kind.
  for (const field of root.querySelectorAll("textarea[data-note]")) {
    const typed = saved.byId.get(field.dataset.note) ?? saved.byKey.get(field.dataset.noteKey);
    if (typed) field.value = typed;
  }
  // The control that had focus, or its successor; when it is gone (an answered
  // decision, a cancelled confirm), the region itself (tabindex=-1).
  const target = saved.focusKey ? root.querySelector(`[data-key="${CSS.escape(saved.focusKey)}"]`) : null;
  if (target) target.focus({ preventScroll: true });
  else if (saved.hadFocus && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
}

function draw(route, data, answered) {
  const saved = capture(main);
  if (answered) {
    saved.byId.delete(answered.id);
    saved.byKey.delete(answered.noteKey);
  }
  const screen =
    route.screen === "task"
      ? taskScreen(data)
      : route.screen === "decisions"
        ? decisionsScreen(data)
        : route.screen === "agents"
          ? agentsScreen(data)
          : boardScreen(data);
  main.replaceChildren(screen);
  restore(main, saved);
  state.cueDismissed = false;
  clearNotice("held");
}

function drawFailure(route, error) {
  const missing = route.screen === "task" && error?.status === 404;
  const text = missing ? L("taskNotFound") : errorText(error, lang);
  if (state.drawn === `!${text}`) return;
  state.drawn = `!${text}`;
  main.replaceChildren(
    el("div", { className: "state error", role: "alert" }, [
      el("p", null, text),
      route.screen === "task" ? el("a", { href: "#/tasks" }, L("backToBoard")) : null,
      missing ? null : el("button", { type: "button", className: "btn", onClick: () => load({ force: true }) }, L("retry")),
    ]),
  );
}

// --- Shared pieces --------------------------------------------------------

const field = (id, label, control, hint) =>
  el("div", { className: "field" }, [el("label", { for: id }, label), control, hint ?? null]);

const section = (title, content) =>
  el("section", { className: "section" }, [el("h2", null, title), content]);

/** A fold whose open state survives the poll's redraws. */
function fold(key, summary, content) {
  return el(
    "details",
    {
      open: state.open.has(key),
      onToggle: (e) => {
        if (e.currentTarget.open) state.open.add(key);
        else state.open.delete(key);
      },
    },
    [el("summary", { dataset: { key: `fold:${key}` } }, summary), content],
  );
}

/** The in-screen confirm: a question, [yes] and [keep]. Escape keeps. While
 * it shows, the poll leaves the screen alone (data-hold). `run` failing shows
 * its error here and leaves the choice open. */
function confirmBox({ question, yesLabel, run, back }) {
  const error = el("p", { className: "inline-error", role: "alert" });
  const no = el("button", { type: "button", className: "btn", onClick: () => back() }, L("keep"));
  const yes = el(
    "button",
    {
      type: "button",
      className: "btn danger solid",
      onClick: () => {
        error.textContent = "";
        act([yes, no], run, (text) => {
          error.textContent = text;
        });
      },
    },
    yesLabel,
  );
  const box = el(
    "div",
    {
      className: "confirm-box",
      role: "group",
      "aria-label": question,
      dataset: { hold: "1" },
      onKeydown: (e) => {
        if (e.key === "Escape" && !yes.disabled) {
          e.preventDefault();
          back();
        }
      },
    },
    [el("p", null, question), el("div", { className: "actions" }, [yes, no]), error],
  );
  return { box, focus: () => no.focus() };
}

// --- Board ------------------------------------------------------------------

function boardScreen(board) {
  const columns = columnsView(board, lang);
  const total = columns.reduce((n, c) => n + c.cards.length, 0);
  return el("div", null, [
    el("h1", { className: "sr-only" }, L("navTasks")),
    total ? null : el("p", { className: "board-empty" }, L("boardEmpty")),
    el(
      "div",
      { className: "board", dataset: { scrollKey: "board" } },
      columns.map((column) =>
        el("section", { className: `column ${column.key}`, "aria-labelledby": `col-${column.key}` }, [
          el("div", { className: "column-head" }, [
            el("h2", { id: `col-${column.key}` }, column.label),
            el("span", { className: "count" }, column.cards.length),
          ]),
          column.cards.length
            ? el(
                "ol",
                { className: "cards" },
                column.cards.map((card) =>
                  el(
                    "li",
                    null,
                    el("a", { className: "card", href: card.href, dataset: { key: `card:${card.id}` } }, [
                      el("span", { className: "card-title" }, card.title),
                      el("span", { className: "meta" }, [
                        el("span", null, card.agent),
                        el("span", { className: `chip stage-${card.stage}` }, card.stageLabel),
                        card.stopped ? el("span", { className: "chip stopped" }, L("stopped")) : null,
                        card.high ? el("span", { className: "risk" }, L("highRisk")) : null,
                      ]),
                    ]),
                  ),
                ),
              )
            : el("p", { className: "empty" }, L("emptyColumn")),
        ]),
      ),
    ),
  ]);
}

// --- Decisions ----------------------------------------------------------------

function decisionList(items, showTask) {
  return el(
    "ol",
    { className: "decisions" },
    items.map((item) => el("li", null, decisionCard(item, showTask))),
  );
}

/** One decision: what it is about, the readable summary, the full text folded,
 * a note when an option needs one, and its options. Option 2 (reject: the task
 * is cancelled) asks in-screen first. */
function decisionCard(item, showTask) {
  const d = decisionView(item, lang);
  const noteKey = `${d.taskId}:${d.kind}`;
  const error = el("p", { className: "inline-error", role: "alert" });
  const noteId = uid("note"),
    hintId = uid("hint");
  const note = d.needsNote
    ? el("textarea", {
        id: noteId,
        rows: 4,
        maxlength: NOTE_LIMIT,
        "aria-describedby": hintId,
        dataset: { note: d.id, noteKey, key: `note:${d.id}` },
      })
    : null;
  const buttons = d.options.map((option) =>
    el(
      "button",
      {
        type: "button",
        className: `btn ${option.danger ? "danger" : "primary"}`,
        dataset: { key: `opt:${d.id}:${option.number}` },
        onClick: () => choose(option),
      },
      option.label,
    ),
  );
  const actions = el("div", { className: "actions" }, buttons);

  async function reply(option) {
    try {
      await api("POST", `/api/decisions/${encodeURIComponent(d.id)}/reply`, {
        option: option.number,
        note: note ? note.value : "",
      });
    } catch (failure) {
      // The engine renewed it: show the new one (typed notes carry over).
      if (failure?.body?.error === "STALE_APPROVAL") {
        say(errorText(failure, lang), "error");
        await load({ force: true });
        return;
      }
      throw failure;
    }
    say(L("replied"));
    await load({ force: true, answered: { id: d.id, noteKey } });
  }
  function choose(option) {
    error.textContent = "";
    if (option.needsNote) {
      const text = note?.value ?? "";
      if (!text.trim()) {
        error.textContent = L("noteRequired");
        note?.focus();
        return;
      }
      if (text.length > NOTE_LIMIT) {
        error.textContent = L("noteTooLong");
        note?.focus();
        return;
      }
    }
    if (option.danger) return askReject(option);
    act(buttons, () => reply(option), (text) => {
      error.textContent = text;
    });
  }
  function askReject(option) {
    const back = () => {
      asking.box.replaceWith(actions);
      buttons[d.options.indexOf(option)]?.focus();
    };
    const asking = confirmBox({ question: L("rejectAsk"), yesLabel: option.label, run: () => reply(option), back });
    actions.replaceWith(asking.box);
    asking.focus();
  }

  // h2 under the Decisions screen's h1; h3 under a task's section heading.
  // The link opens the request; a subtask's own title follows as plain text.
  const head = el("div", { className: "decision-head" }, [
    el(
      showTask ? "h2" : "h3",
      null,
      showTask && d.href
        ? el("a", { href: d.href, dataset: { key: `task-link:${d.id}` } }, d.rootTitle || d.gate)
        : showTask
          ? d.rootTitle || d.taskTitle || d.gate
          : d.gate,
    ),
    el("div", { className: "meta" }, [
      showTask ? el("span", { className: "chip" }, d.gate) : null,
      d.subtaskTitle ? el("span", { className: "muted" }, d.subtaskTitle) : null,
      el("span", null, formatTime(item.created_at, lang)),
    ]),
  ]);
  const showDetail = d.detail && d.detail.trim() !== d.summary;
  return el("article", { className: "decision", "aria-label": d.title }, [
    head,
    d.summary ? el("p", { className: "summary" }, d.summary) : null,
    showDetail
      ? fold(`detail:${d.id}`, L("showDetail"), el("pre", { className: "code wrap", dataset: { copy: "1" } }, d.detail))
      : null,
    note
      ? el("div", { className: "field" }, [
          el("label", { for: noteId }, d.noteLabel),
          note,
          el("p", { className: "hint", id: hintId }, d.noteHint),
        ])
      : null,
    actions,
    error,
  ]);
}

function decisionsScreen(decisions) {
  return el("div", { className: "page" }, [
    el("div", { className: "page-head" }, [
      el("div", { className: "head-text" }, [
        el("h1", null, L("decisionsTitle")),
        decisions.length ? el("p", { className: "muted" }, L("openDecisions", { n: decisions.length })) : null,
      ]),
    ]),
    decisions.length ? decisionList(decisions, true) : el("p", { className: "state" }, L("decisionsEmpty")),
  ]);
}

// --- Task detail --------------------------------------------------------------

function taskScreen(task) {
  const closed = task.status === "done" || task.status === "cancelled";
  const stop = stopView(task, lang);
  return el("article", { className: "page" }, [
    el("div", { className: "page-head" }, [
      el("div", { className: "head-text" }, [
        el("a", { href: "#/tasks", dataset: { key: "back" } }, L("backToBoard")),
        el("h1", null, task.title),
        el("div", { className: "meta" }, [
          el("span", null, agentName(task.agent?.name ?? null, lang)),
          el("span", { className: `chip stage-${task.stage}` }, stageLabel(task.stage, lang)),
          stop ? el("span", { className: "chip stopped" }, stop.label) : null,
        ]),
      ]),
      closed ? null : cancelControl(task),
    ]),
    stop
      ? el("div", { className: "stop-note", role: "status" }, [
          stop.reason ? el("p", { className: "text" }, stop.reason) : null,
          el("p", { className: "hint" }, stop.hint),
        ])
      : null,
    task.decisions?.length ? section(L("sectionDecisions"), decisionList(task.decisions, false)) : null,
    task.summary ? section(L("sectionSummary"), el("div", { className: "text body-text" }, task.summary)) : null,
    section(
      L("sectionBody"),
      task.body ? el("div", { className: "text body-text" }, task.body) : el("p", { className: "empty" }, L("noBody")),
    ),
    section(L("sectionEvents"), eventList(task.events ?? [])),
    section(L("sectionDiffs"), diffList(task.diffs ?? [])),
    section(L("sectionRuns"), runList(task.runs ?? [])),
    section(L("sectionDeliveries"), deliveryList(task.deliveries ?? [])),
  ]);
}

function cancelControl(task) {
  const trigger = el(
    "button",
    { type: "button", className: "btn danger", dataset: { key: "cancel-task" }, onClick: () => ask() },
    L("cancelTask"),
  );
  const slot = el("div", null, trigger);
  function ask() {
    const asking = confirmBox({
      question: L("cancelTaskAsk"),
      yesLabel: L("cancelTask"),
      run: async () => {
        await api("POST", `/api/tasks/${encodeURIComponent(task.id)}/cancel`);
        say(L("taskCancelled"));
        await load({ force: true });
      },
      back: () => {
        slot.replaceChildren(trigger);
        trigger.focus();
      },
    });
    slot.replaceChildren(asking.box);
    asking.focus();
  }
  return slot;
}

const timeOf = (at) =>
  el("time", { datetime: Number.isFinite(at) ? new Date(at).toISOString() : undefined }, formatTime(at, lang));

function eventList(events) {
  if (!events.length) return el("p", { className: "empty" }, L("noEvents"));
  return el(
    "ol",
    { className: "events" },
    events.map((e) => el("li", null, [timeOf(e.at), el("div", { className: "text" }, e.text)])),
  );
}

function diffList(diffs) {
  if (!diffs.length) return el("p", { className: "empty" }, L("noDiffs"));
  return el(
    "div",
    { className: "section" },
    diffs.map((d) => {
      const status = diffState(d);
      if (status !== "ready")
        return el("div", { className: "fold-off" }, [
          el("span", null, d.title),
          el("span", { className: "chip" }, L(status === "preparing" ? "diffPreparing" : "diffUnavailable")),
        ]);
      const key = `diff:${d.taskId}`;
      const stat = String(d.stat ?? "").trim();
      const total = stat.split("\n").at(-1) ?? "";
      return fold(
        key,
        [el("span", null, d.title), total ? el("span", { className: "stat" }, total) : null],
        el("pre", { className: "code", dataset: { scrollKey: key, copy: "1" } }, [
          stat ? `${stat}\n\n` : "",
          d.diff || L("noDiffs"),
        ]),
      );
    }),
  );
}

function runList(runs) {
  if (!runs.length) return el("p", { className: "empty" }, L("noRuns"));
  return el(
    "ul",
    { className: "rows" },
    runs.map((r) =>
      el("li", null, [
        el("strong", null, roleLabel(r.role, lang)),
        el("span", { className: "path" }, runnerLabel(r)),
        r.version ? el("span", { className: "muted" }, r.version) : null,
        timeOf(r.at),
      ]),
    ),
  );
}

function deliveryList(deliveries) {
  if (!deliveries.length) return el("p", { className: "empty" }, L("noDeliveries"));
  return el(
    "ul",
    { className: "rows" },
    deliveries.map((d) =>
      el("li", null, [
        el("span", { className: d.status === "delivered" ? "chip stage-g4" : "chip" }, deliveryLabel(d.status, lang)),
        // Plain, selectable text: the person copies it; it is not a link.
        d.directory
          ? el("code", { className: "path", dataset: { copy: "1" } }, d.directory)
          : el("span", { className: "muted" }, L("deliveryNoDirectory")),
      ]),
    ),
  );
}

// --- Agents -------------------------------------------------------------------

function agentsScreen(agents) {
  return el("div", { className: "page" }, [
    el("div", { className: "page-head" }, [
      el("h1", null, L("agentsTitle")),
      el(
        "button",
        {
          type: "button",
          className: "btn primary",
          dataset: { key: "add-agent" },
          onClick: (e) => openAgentDialog(null, e.currentTarget),
        },
        L("addAgent"),
      ),
    ]),
    agents.length
      ? el("ul", { className: "agents" }, agents.map(agentCard))
      : el("p", { className: "state" }, L("agentsEmpty")),
  ]);
}

function agentCard(agent) {
  const edit = el(
    "button",
    {
      type: "button",
      className: "btn",
      "aria-label": `${L("editAgent")}: ${agent.name}`,
      dataset: { key: `edit:${agent.id}` },
      onClick: (e) => openAgentDialog(agent, e.currentTarget),
    },
    L("editAgent"),
  );
  const remove = el(
    "button",
    {
      type: "button",
      className: "btn danger",
      "aria-label": `${L("deleteAgent")}: ${agent.name}`,
      dataset: { key: `delete:${agent.id}` },
      onClick: () => ask(),
    },
    L("deleteAgent"),
  );
  const tools = el("div", { className: "actions" }, [edit, remove]);
  function ask() {
    const asking = confirmBox({
      question: L("deleteAgentAsk"),
      yesLabel: L("deleteAgent"),
      run: async () => {
        await api("DELETE", `/api/agents/${encodeURIComponent(agent.id)}`);
        say(L("agentDeleted"));
        await load({ force: true });
      },
      back: () => {
        asking.box.replaceWith(tools);
        remove.focus();
      },
    });
    tools.replaceWith(asking.box);
    asking.focus();
  }
  return el("li", { className: "agent" }, [
    el("div", { className: "agent-head" }, [
      el("div", { className: "agent-name" }, [
        el("h2", null, agent.name),
        agent.busy ? el("span", { className: "working" }, L("busy")) : null,
      ]),
      tools,
    ]),
    el("dl", { className: "runner-lines" }, [
      el("dt", null, L("workShort")),
      el("dd", null, runnerLabel(agent.work)),
      el("dt", null, L("reviewShort")),
      el("dd", null, runnerLabel(agent.review)),
    ]),
  ]);
}

// --- Dialogs ------------------------------------------------------------------

/** A modal `<dialog>`: Escape closes it, focus goes back to `trigger`, and
 * the poll does not redraw the screen while it is open. `build` fills it and
 * returns the control to focus first. It sends with `send` (act for this
 * dialog): while a request is in flight, Escape and Close do nothing, so the
 * dialog cannot be closed and reopened into a second request; a failure that
 * still arrives after a close goes to the page notice. */
function openDialog(trigger, build) {
  const dialog = el("dialog", null);
  let busy = false;
  const close = () => {
    if (dialog.open && !busy) dialog.close();
  };
  dialog.addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  async function send(controls, run, onError) {
    busy = true;
    try {
      return await act(controls, run, (text, error) => (dialog.open ? onError(text, error) : say(text, "error")));
    } finally {
      busy = false;
    }
  }
  dialog.addEventListener("close", () => {
    dialog.remove();
    // A redraw may have replaced the trigger: its successor has the same key.
    const key = trigger?.dataset?.key;
    const target = trigger?.isConnected
      ? trigger
      : key
        ? main.querySelector(`[data-key="${CSS.escape(key)}"]`)
        : null;
    (target ?? main).focus({ preventScroll: true });
    // Catch up with what changed while it was open (unless a load already runs).
    if (!state.loadingSeq) load();
  });
  const first = build(dialog, close, send);
  document.body.append(dialog);
  dialog.showModal();
  first?.focus();
}

function openTaskDialog(trigger) {
  openDialog(trigger, (dialog, close, send) => {
    const headId = uid("head"),
      titleId = uid("title"),
      bodyId = uid("body"),
      riskName = uid("risk");
    const title = el("input", { type: "text", id: titleId, autocomplete: "off" });
    const body = el("textarea", { id: bodyId, rows: 6 });
    const normal = el("input", { type: "radio", name: riskName, value: "normal", checked: true });
    const high = el("input", { type: "radio", name: riskName, value: "high" });
    const agentSlot = el("div", null, el("p", { className: "hint" }, L("loading")));
    const error = el("p", { className: "inline-error", role: "alert" });
    const create = el("button", { type: "submit", className: "btn primary", disabled: true }, L("create"));
    const shut = el("button", { type: "button", className: "btn", onClick: close }, L("close"));
    let agentSelect = null;

    async function submit(e) {
      e.preventDefault();
      if (!agentSelect) return;
      const problem = taskTitleError(title.value, lang);
      if (problem) {
        error.textContent = problem;
        title.focus();
        return;
      }
      const tooLong = taskBodyError(title.value, body.value, lang);
      if (tooLong) {
        error.textContent = tooLong;
        body.focus();
        return;
      }
      error.textContent = "";
      create.textContent = L("creating");
      const ok = await send(
        [create, shut],
        () =>
          api("POST", "/api/tasks", {
            title: title.value.trim(),
            body: body.value,
            agentId: agentSelect.value,
            risk: high.checked ? "high" : "normal",
          }),
        (text) => {
          error.textContent = text;
        },
      );
      create.textContent = L("create");
      if (!ok) return;
      close();
      say(L("taskCreated"));
      // Leaving would drop a typed note or an open confirm: then stay, and let
      // the board show the new task when the person goes there.
      if (afterCreate(state.route.screen, regionHeld(main, document)) === "navigate") location.hash = "#/tasks";
      else load();
    }

    dialog.setAttribute("aria-labelledby", headId);
    dialog.append(
      el("form", { className: "dialog-form", novalidate: true, onSubmit: submit }, [
        el("h2", { id: headId }, L("newTask")),
        field(titleId, L("title"), title),
        field(bodyId, L("body"), body),
        agentSlot,
        el("fieldset", null, [
          el("legend", null, L("risk")),
          el("div", { className: "radio-row" }, [
            el("label", null, [normal, L("riskNormal")]),
            el("label", null, [high, L("riskHigh")]),
          ]),
        ]),
        error,
        el("div", { className: "dialog-foot" }, [shut, create]),
      ]),
    );

    api("GET", "/api/agents").then(
      (data) => {
        if (!dialog.open) return;
        const agents = [...(Array.isArray(data?.agents) ? data.agents : [])].sort((a, b) => a.createdAt - b.createdAt);
        if (!agents.length) {
          agentSlot.replaceChildren(
            el("p", null, L("noAgents")),
            el("a", { href: "#/agents", onClick: () => close() }, L("goAgents")),
          );
          return;
        }
        const id = uid("agent");
        agentSelect = el(
          "select",
          { id },
          agents.map((a) => el("option", { value: a.id }, a.busy ? `${a.name} (${L("busy")})` : a.name)),
        );
        // The oldest agent is the default one.
        agentSelect.value = agents[0].id;
        agentSlot.replaceChildren(field(id, L("agent"), agentSelect));
        create.disabled = false;
      },
      (failure) => {
        if (dialog.open) agentSlot.replaceChildren(el("p", { className: "inline-error" }, errorText(failure, lang)));
      },
    );
    return title;
  });
}

/** CLI, model and effort for one of an agent's two runners. When editing, an
 * untouched picker is not sent (its value() is undefined). */
function runnerPicker(legend, current, editing) {
  const slot = el("div", null, el("p", { className: "hint" }, L("runnersLoading")));
  const fieldset = el("fieldset", null, [
    el("legend", null, legend),
    current ? el("p", { className: "hint" }, L("current", { value: runnerLabel(current) })) : null,
    slot,
  ]);
  let cli = null,
    model = null,
    effort = null,
    usable = [],
    touched = false;
  const runnerNow = () => usable.find((r) => r.runner === cli.value);

  function fillModels(prefer) {
    const choices = modelChoices(runnerNow(), lang);
    model.replaceChildren(...choices.map((c) => el("option", { value: c.value ?? "" }, c.label)));
    model.value = choices.some((c) => c.value === prefer) ? prefer : (choices[0].value ?? "");
  }
  function fillEfforts(prefer) {
    const entry = (runnerNow()?.models ?? []).find((m) => m.slug === model.value);
    const choices = effortChoices(entry, lang);
    effort.replaceChildren(...choices.map((c) => el("option", { value: c.value ?? "" }, c.label)));
    effort.value = choices.some((c) => c.value === prefer) ? (prefer ?? "") : "";
  }

  return {
    fieldset,
    fill(view) {
      ({ usable } = runnerOptions(view));
      if (!usable.length) {
        slot.replaceChildren(el("p", { className: "inline-error" }, L("runnersNone")));
        return;
      }
      const cliId = uid("cli"),
        modelId = uid("model"),
        effortId = uid("effort");
      const touch = () => {
        touched = true;
      };
      cli = el(
        "select",
        {
          id: cliId,
          onChange: () => {
            touch();
            fillModels();
            fillEfforts();
          },
        },
        usable.map((r) => el("option", { value: r.runner }, r.runner)),
      );
      model = el("select", {
        id: modelId,
        onChange: () => {
          touch();
          fillEfforts();
        },
      });
      effort = el("select", { id: effortId, onChange: touch });
      cli.value = (usable.find((r) => r.runner === current?.runner) ?? usable[0]).runner;
      fillModels(current?.model);
      fillEfforts(current?.reasoning ?? null);
      slot.replaceChildren(
        el("div", { className: "picker" }, [
          field(cliId, L("cli"), cli),
          field(modelId, L("model"), model),
          field(effortId, L("effort"), effort),
        ]),
      );
    },
    fail(text) {
      slot.replaceChildren(el("p", { className: "inline-error" }, text));
    },
    ready: () => cli !== null,
    value() {
      if (!cli || (editing && !touched)) return undefined;
      return { runner: cli.value, model: model.value || null, effort: effort.value || null };
    },
  };
}

/** Add an agent (`agent` null) or edit one: name and both runners. The runner
 * list is read once, when the dialog opens; it is never polled. */
function openAgentDialog(agent, trigger) {
  openDialog(trigger, (dialog, close, send) => {
    const headId = uid("head"),
      nameId = uid("name");
    const name = el("input", { type: "text", id: nameId, autocomplete: "off", value: agent?.name ?? "" });
    const work = runnerPicker(L("workRunner"), agent?.work, !!agent);
    const review = runnerPicker(L("reviewRunner"), agent?.review, !!agent);
    const hints = el("div", { className: "field" });
    const error = el("p", { className: "inline-error", role: "alert" });
    // Editing can save a new name before the runner list arrives; adding needs it.
    const save = el("button", { type: "submit", className: "btn primary", disabled: !agent }, agent ? L("save") : L("create"));
    const shut = el("button", { type: "button", className: "btn", onClick: close }, L("close"));

    async function submit(e) {
      e.preventDefault();
      error.textContent = "";
      let request;
      if (agent) {
        const patch = agentPatch(agent, { name: name.value, work: work.value(), review: review.value() });
        if (!Object.keys(patch).length) {
          error.textContent = L("nothingChanged");
          return;
        }
        request = () => api("PATCH", `/api/agents/${encodeURIComponent(agent.id)}`, patch);
      } else {
        const w = work.value(),
          r = review.value();
        if (!w || !r) {
          error.textContent = L("runnersNone");
          return;
        }
        request = () => api("POST", "/api/agents", { name: name.value.trim(), work: w, review: r });
      }
      save.textContent = L("saving");
      const ok = await send([save, shut], request, (text) => {
        error.textContent = text;
      });
      save.textContent = agent ? L("save") : L("create");
      if (!ok) return;
      close();
      say(L("agentSaved"));
      // Not forced: an open delete confirm on another agent stays.
      if (state.route.screen !== "agents") location.hash = "#/agents";
      else load();
    }

    dialog.setAttribute("aria-labelledby", headId);
    dialog.append(
      el("form", { className: "dialog-form", novalidate: true, onSubmit: submit }, [
        el("h2", { id: headId }, agent ? `${L("editAgent")} · ${agent.name}` : L("addAgent")),
        field(nameId, L("name"), name),
        work.fieldset,
        review.fieldset,
        hints,
        error,
        el("div", { className: "dialog-foot" }, [shut, save]),
      ]),
    );

    api("GET", "/api/runners").then(
      (view) => {
        if (!dialog.open) return;
        work.fill(view);
        review.fill(view);
        hints.replaceChildren(
          ...runnerOptions(view).unusable.map((u) =>
            el("p", { className: "hint" }, u.hint ? `${L("unusableRunner", { runner: u.runner })} — ${u.hint}` : L("unusableRunner", { runner: u.runner })),
          ),
        );
        if (!agent) save.disabled = !(work.ready() && review.ready());
      },
      (failure) => {
        if (!dialog.open) return;
        const text = `${L("runnersFailed")} ${errorText(failure, lang)}`;
        work.fail(text);
        review.fail(text);
      },
    );
    return name;
  });
}

// --- Start ----------------------------------------------------------------------

document.documentElement.lang = lang;
document.title = L("appName");
buildTop();
window.addEventListener("hashchange", navigate);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") tick();
});
navigate();
state.timer = setTimeout(tick, POLL_MS);
