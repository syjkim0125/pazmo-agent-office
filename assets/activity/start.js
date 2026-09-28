import { mountMonitor } from "./monitor.js";
let monitor = mountMonitor(document);
window.addEventListener("pagehide", () => monitor.dispose());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) monitor = mountMonitor(document);
});
