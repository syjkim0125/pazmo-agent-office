type Evidence = {
  contract?: { title?: string };
  diff?: { rawDiff?: string; rawDiffEncoding?: string };
  results?: { kind?: string; result?: { verdict?: string } }[];
};

/** Undo Git's C-style path quoting: octal escapes are the path's UTF-8 bytes
 * and \" \\ are literal. Letter escapes (\t, \n, …) stay as Git wrote them;
 * Git always writes LF and CR that way, so a path cannot add a line. */
function unquote(path: string): string {
  const bytes: number[] = [];
  for (const [, octal, literal, plain] of path.matchAll(/\\([0-7]{3})|\\(["\\])|(\\.|[^\\]+)/g))
    if (octal) bytes.push(Number.parseInt(octal, 8));
    else if (literal) bytes.push(literal.charCodeAt(0));
    else bytes.push(...Buffer.from(plain));
  return Buffer.from(bytes).toString();
}

/** Three plain lines under the G4 questions saying what the change is. Built
 * only from the stored evidence (no model call), so it can never disagree
 * with the verbatim evidence printed below it. */
export function changeSummary(evidence: Evidence): string {
  const title = evidence.contract?.title?.trim() || "제목 없음";
  let files: string;
  const raw = evidence.diff?.rawDiff ?? "";
  if (evidence.diff?.rawDiffEncoding !== "utf8") files = "바이너리 변경";
  else {
    const paths: string[] = [];
    let added = 0,
      removed = 0;
    for (const line of raw.split("\n")) {
      // The candidate diff compares folders a and b, so an added file is headed b/… b/… and a deleted one a/… a/….
      // Git quotes both sides when a path has non-ASCII bytes or `"`: "b/\354\235\270.js".
      const header =
        /^diff --git "[ab]\/(?:[^"\\]|\\.)*" "[ab]\/((?:[^"\\]|\\.)*)"$|^diff --git [ab]\/.+ [ab]\/(.+)$/.exec(
          line,
        );
      if (header) paths.push(header[2] ?? unquote(header[1]));
      else if (line.startsWith("+") && !line.startsWith("+++")) added++;
      else if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }
    const shown = paths.slice(0, 3).join(", ");
    const more = paths.length > 3 ? ` 외 ${paths.length - 3}개` : "";
    files = paths.length
      ? `${shown}${more} (+${added} −${removed}줄)`
      : "변경 없음";
  }
  const results = evidence.results ?? [];
  const tests = results.filter((r) => r.kind === "test");
  const passed = tests.filter((r) => r.result?.verdict === "pass").length;
  const checks = !tests.length
    ? "검사 없음"
    : passed === tests.length
      ? `검사 ${tests.length}개 통과`
      : `검사 ${passed}/${tests.length} 통과`;
  const review = results.find((r) => r.kind === "review");
  const reviewed = !review
    ? "리뷰 없음"
    : review.result?.verdict === "pass"
      ? "리뷰 통과"
      : "리뷰 실패";
  return `[변경사항]\n1. 작업: ${title}\n2. 변경 파일: ${files}\n3. 확인: ${checks} · ${reviewed}`;
}
