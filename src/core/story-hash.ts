import { digest } from "./candidates.ts";

/** The canonical hash of a Story's requirements: the text without its progress lines (Status, gate records, G4),
 * trimmed, as sha256 hex. A G1 binds this, so one approval cannot be reused for another Story text, and the Hub keys an
 * uploaded Story by it (`upload:<hash>`): the algorithm must not change, or Stories already uploaded get new keys. */
export function hashStory(text: string): string {
  return digest(
    text
      .split(/\r?\n/)
      .filter(
        (line) => !/^(?:Status:|Understanding gate \(G[134]\):|G4:)/i.test(line),
      )
      .join("\n")
      .trim(),
  );
}
