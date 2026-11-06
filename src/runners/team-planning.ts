import type { PlanRound } from "../hub/plan-protocol.ts";
import { TEAM_FOLDER, oneLine } from "./planning.ts";
import type { PlanningDialogue } from "./planning.ts";

/** A project repo and its folder in a team plan's snapshot (`/candidate/tree/<folder>`). */
export type TeamRepoFolder = { folder: string; repoId: string; name: string; baseBranch: string };

/**
 * One snapshot folder per repo: the repo's name when it is a plain folder name that no other repo of the project
 * shares (ignoring case, since a Mac's disk does), else `repo-<first 8 characters of its id>`. Names that collide are
 * all renamed, so a folder does not depend on the order the Hub lists the repos in. A fallback that would still land
 * on another folder takes the whole id.
 */
export function repoFolders(repos: { id: string; name: string; baseBranch: string }[]): TeamRepoFolder[] {
  const count = (names: string[]) => {
    const seen = new Map<string, number>();
    for (const name of names) seen.set(name.toLowerCase(), (seen.get(name.toLowerCase()) ?? 0) + 1);
    return seen;
  };
  const safe = count(repos.filter((r) => TEAM_FOLDER.test(r.name)).map((r) => r.name));
  const first = repos.map((r) =>
    TEAM_FOLDER.test(r.name) && safe.get(r.name.toLowerCase()) === 1 ? r.name : `repo-${r.id.slice(0, 8)}`,
  );
  const taken = count(first);
  return repos.map((r, i) => ({
    folder: first[i] !== r.name && taken.get(first[i].toLowerCase())! > 1 ? `repo-${r.id}` : first[i],
    repoId: r.id,
    name: r.name,
    baseBranch: r.baseBranch,
  }));
}

/** The answered question rounds as a PM packet's dialogue: no `blocking` mark, each answer folded to one line. */
export function dialogueOf(rounds: PlanRound[]): PlanningDialogue[] {
  return rounds.flatMap((round) =>
    round.answers === null
      ? []
      : [
          {
            questions: round.questions.map(({ id, text, reason }) => ({ id, text, reason })),
            answers: round.answers.map(({ id, answer }) => ({ id, answer: oneLine(answer) })),
          },
        ],
  );
}

/** Every answered question with its answer, both on one line: what the draft's Decisions record as the PL's answers. */
export function decidedOf(rounds: PlanRound[]): { question: string; answer: string }[] {
  return rounds.flatMap((round) =>
    round.questions.flatMap((question) => {
      const answer = round.answers?.find((a) => a.id === question.id);
      return answer ? [{ question: oneLine(question.text), answer: oneLine(answer.answer) }] : [];
    }),
  );
}
