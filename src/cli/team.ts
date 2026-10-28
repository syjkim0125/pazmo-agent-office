import { dataRoot, fail } from "./project.ts";
import { addTeamRepo, readTeam, removeTeamRepo } from "../team/registry.ts";

export const TEAM_ACTIONS: readonly string[] = ["add", "remove", "list"];

/** `team add|remove --project PATH` and `team list`, all against the registry in
 * the data root. `list` shows the whole registry, so it takes no project (one is
 * accepted and ignored). */
export async function teamCommand(
  action: string,
  options: { project?: string; dataDir?: string },
) {
  const root = dataRoot(options.dataDir);
  if (action === "list") return { repos: readTeam(root).repos };
  if (options.project === undefined)
    return fail("ARGUMENT", "--project is required.");
  if (action === "add") return addTeamRepo(root, options.project);
  await removeTeamRepo(root, options.project);
  return { removed: true };
}
