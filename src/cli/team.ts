import { join, resolve } from "node:path";
import { dataRoot, fail, packageRoot } from "./project.ts";
import { addTeamRepo, readTeam, removeTeamRepo, teamDir } from "../team/registry.ts";
import { openTeamStore, waitingOf } from "../team/store.ts";
import { runUpload } from "../team/upload.ts";

export const TEAM_ACTIONS: readonly string[] = [
  "add",
  "remove",
  "list",
  "pause",
  "resume",
  "cap",
  "status",
  "rerun",
  "upload",
];

/** The claude guide `team upload --guide` prints: the same file the repo keeps as a skill (K8). */
export const UPLOAD_GUIDE = join(packageRoot, "skills", "pazmo-hub-upload", "SKILL.md");

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
 * take no project either). `rerun` writes the member's request to run the
 * failed Task again, with its memo; a live team Office (`--live`, `up --team`)
 * that is running, or the next one that starts, asks the Hub for it. `upload`
 * puts a locally approved kit Story (`--story`) and its Task file (`--tasks`)
 * on the Hub and opens it; its `--project` is the Hub project's name or id. */
export async function teamCommand(
  action: string,
  options: { project?: string; dataDir?: string; value?: string; memo?: string; story?: string; tasks?: string },
) {
  const root = dataRoot(options.dataDir);
  if (action === "upload") {
    if (typeof options.story !== "string" || typeof options.tasks !== "string")
      return fail("ARGUMENT", "team upload needs --story <Story.md> and --tasks <tasks.json> (see team upload --guide).");
    return runUpload({
      root,
      story: resolve(options.story),
      tasks: resolve(options.tasks),
      ...(options.project !== undefined ? { project: options.project } : {}),
    });
  }
  if (action === "list") return { repos: readTeam(root).repos };
  if (action === "rerun") {
    if (typeof options.memo !== "string")
      return fail("ARGUMENT", 'team rerun needs --memo "<text>": what to do differently this time.');
    const store = openTeamStore(teamDir(root));
    try {
      // NO_FAILED_CLAIM unless the open record failed; INVALID over 2000 characters.
      store.requestRerun(options.memo);
      return { requested: true };
    } finally {
      store.close();
    }
  }
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
          // `failed` is what team rerun asks to run again.
          phase: claim.phase,
          attempts: claim.attempts,
          waiting: waitingOf(claim),
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
