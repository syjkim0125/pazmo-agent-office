/**
 * Static script for the board's GET pages: it re-reads the page every 10 s while the tab is shown, and swaps in the new
 * <main> and title only when nothing in a form is being typed and no text in <main> is selected (a skipped swap is
 * tried again next tick). Open <details> stay open (matched by summary text and order) and focus comes back by id.
 * A failed read stops it and takes `html.live` off, so the 새로 고침 link shows again. It holds no secret and sends the
 * page's own address only.
 */
export const LIVE_SCRIPT = `(function () {
  var PERIOD = 10000;
  var root = document.documentElement;
  root.classList.add("live");
  var meta = document.querySelector('meta[name="etag"]');
  var etag = meta ? meta.getAttribute("content") : "";
  var timer = null, busy = false;
  function typing() {
    var a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT")) return true;
    var fields = document.querySelectorAll("form input, form textarea, form select");
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.tagName === "SELECT") {
        for (var j = 0; j < f.options.length; j++) if (f.options[j].selected !== f.options[j].defaultSelected) return true;
      } else if (f.type === "checkbox" || f.type === "radio") {
        if (f.checked !== f.defaultChecked) return true;
      } else if (f.value !== f.defaultValue) return true;
    }
    return false;
  }
  function selecting(main) {
    var sel = typeof getSelection === "function" ? getSelection() : null;
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    for (var i = 0; i < sel.rangeCount; i++) if (sel.getRangeAt(i).intersectsNode(main)) return true;
    return false;
  }
  // Each <details> of <main> by its summary text and its place among the details with that text.
  function eachDetails(main, fn) {
    var seen = {}, all = main.querySelectorAll("details");
    for (var i = 0; i < all.length; i++) {
      var s = all[i].querySelector("summary");
      var text = s ? s.textContent.trim() : "";
      seen[text] = (seen[text] || 0) + 1;
      fn(all[i], text + "\\u0000" + seen[text]);
    }
  }
  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    root.classList.remove("live");
  }
  function tick() {
    var main = document.querySelector("main");
    if (busy || document.hidden || typing() || (main && selecting(main))) return;
    busy = true;
    var headers = {};
    if (etag) headers["If-None-Match"] = etag;
    fetch(location.href, { headers: headers, cache: "no-store", credentials: "same-origin" }).then(function (res) {
      if (res.status === 304) return;
      if (res.status !== 200) return stop();
      return res.text().then(function (text) {
        // The form may have been touched while the request was out.
        var main = document.querySelector("main");
        if (document.hidden || typing() || !main || selecting(main)) return;
        var next = new DOMParser().parseFromString(text, "text/html");
        var fresh = next.querySelector("main");
        if (!fresh) return;
        var open = {};
        eachDetails(main, function (d, key) { if (d.open) open[key] = true; });
        var a = document.activeElement;
        var focusId = a && a !== document.body && a.id && main.contains(a) ? a.id : "";
        main.innerHTML = fresh.innerHTML;
        eachDetails(main, function (d, key) { if (open[key]) d.open = true; });
        if (focusId) {
          var again = document.getElementById(focusId);
          if (again && again.focus) again.focus();
        }
        if (next.title) document.title = next.title;
        var tag = res.headers.get("ETag");
        if (tag) etag = tag;
      });
    }).catch(function () {}).then(function () { busy = false; });
  }
  timer = setInterval(tick, PERIOD);
})();
`;
