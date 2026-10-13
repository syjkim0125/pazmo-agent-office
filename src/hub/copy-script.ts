/** Static script for the one-time value page: a real "복사" button, no network, no eval. */
export const COPY_SCRIPT = `(function () {
  var DONE = "복사됨", IDLE = "복사", MANUAL = "선택됨 — Cmd+C로 복사";
  function select(target) {
    var range = document.createRange();
    range.selectNodeContents(target);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest("button[data-copy-target]") : null;
    if (!button) return;
    var target = document.getElementById(button.getAttribute("data-copy-target"));
    if (!target) return;
    var text = target.textContent;
    function failed() {
      select(target);
      button.textContent = MANUAL;
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) return failed();
    navigator.clipboard.writeText(text).then(function () {
      button.textContent = DONE;
      clearTimeout(button._copyTimer);
      button._copyTimer = setTimeout(function () { button.textContent = IDLE; }, 2000);
    }, failed);
  });
})();
`;
