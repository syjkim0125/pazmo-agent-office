import { dataRoot, fail } from "./project.ts";
import { addTeamRepo, readTeam, removeTeamRepo, teamDir } from "../team/registry.ts";
import { openTeamStore } from "../team/store.ts";

export const TEAM_ACTIONS: readonly string[] = [
  "add",
  "remove",
  "list",
  "pause",
  "resume",
  "cap",
  "status",
];

/** `cap` is N or `off`. Anything else becomes NaN, which the store refuses as INVALID. */
function parseCap(value: string | undefined): number | null {
  if (value === undefined)
    return fail("ARGUMENT", "team cap needs a number from 1 to 100, or off.");
  if (value === "off") return null;
  return /^\d+$/.test(value) ? Number(value) : NaN;
}

/** `team add|remove --project PATH` and `team list`, all against the registry in
 * the data root; `list` shows the whole registry, so it takes no project (one is
 * accepted and ignored). `pause|resume|cap|status` read and write the team
 * settings in the same data root, so they work while no Office is running (and
 * take no project either). */
export async function teamCommand(
  action: string,
  options: { project?: string; dataDir?: string; value?: string },
) {
  const root = dataRoot(options.dataDir);
  if (action === "list") return { repos: readTeam(root).repos };
  if (["pause", "resume", "cap", "status"].includes(action)) {
    // Refuse a bad cap before the database is touched.
    const cap = action === "cap" ? parseCap(options.value) : null;
    const store = openTeamStore(teamDir(root));
    try {
      if (action === "pause") store.setPaused(true);
      if (action === "resume") store.setPaused(false);
      if (action === "cap") store.setDailyCap(cap);
      const settings = store.settings();
      if (action !== "status") return settings;
      const claim = store.openClaim();
      return {
        ...settings,
        today: store.claimedToday(),
        // The Task spec stays in the database; status names the Task only.
        claim: claim && {
          taskId: claim.taskId,
          claimId: claim.claimId,
          project: claim.project,
          title: claim.task.title,
        },
        repos: readTeam(root).repos,
      };
    } finally {
      store.close();
    }
  }
  if (options.project === undefined)
    return fail("ARGUMENT", "--project is required.");
  if (action === "add") return addTeamRepo(root, options.project);
  await removeTeamRepo(root, options.project);
  return { removed: true };
}
