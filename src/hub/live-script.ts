/**
 * Static script for the board's GET pages: it re-reads the page every 10 s while the tab is shown, and swaps in the new
 * <main> and title only when nothing in a form is being typed. It holds no secret and sends the page's own address only.
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
  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
  function tick() {
    if (busy || document.hidden || typing()) return;
    busy = true;
    var headers = {};
    if (etag) headers["If-None-Match"] = etag;
    fetch(location.href, { headers: headers, cache: "no-store", credentials: "same-origin" }).then(function (res) {
      if (res.status === 304) return;
      if (res.status !== 200) return stop();
      return res.text().then(function (text) {
        // The form may have been touched while the request was out.
        if (document.hidden || typing()) return;
        var next = new DOMParser().parseFromString(text, "text/html");
        var main = document.querySelector("main"), fresh = next.querySelector("main");
        if (!main || !fresh) return;
        main.innerHTML = fresh.innerHTML;
        if (next.title) document.title = next.title;
        var tag = res.headers.get("ETag");
        if (tag) etag = tag;
      });
    }).catch(function () {}).then(function () { busy = false; });
  }
  timer = setInterval(tick, PERIOD);
})();
`;
