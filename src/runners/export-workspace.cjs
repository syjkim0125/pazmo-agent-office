// Trusted export in a fresh read-only container, after the writer has been removed.
// No candidate module, shell, archive extractor or symlink target is executed.
const fs = require("node:fs"),
  path = require("node:path");
const root = "/candidate/tree",
  scope = JSON.parse(process.argv[1]),
  entries = [];
const contains = (r, p) => r === "." || r === p || p.startsWith(r + "/");
let visited = 0,
  total = 0;
if (!fs.lstatSync(root).isDirectory()) throw Error("UNSAFE_ROOT");
function walk(directory, prefix) {
  for (const name of fs.readdirSync(directory)) {
    if (++visited > 20000) throw Error("ENTRY_LIMIT");
    const rel = prefix + name,
      file = path.join(directory, name);
    if (rel.length > 1024 || /[\\\x00-\x1f]/.test(rel))
      throw Error("UNSAFE_PATH");
    if (
      [".git", ".pazmo-office", ".codex", ".ssh"].includes(name) ||
      name === ".env" ||
      (name.startsWith(".env.") &&
        ![".env.example", ".env.sample", ".env.template"].includes(name))
    )
      throw Error("PROTECTED_PATH");
    if (scope.exclude.some((p) => contains(p, rel))) continue;
    const stat = fs.lstatSync(file),
      included = scope.include.some((p) => contains(p, rel));
    if (
      !included &&
      !(stat.isDirectory() && scope.include.some((p) => contains(rel, p)))
    )
      throw Error("OUTSIDE_WORKSPACE");
    if (stat.isDirectory()) walk(file, rel + "/");
    else {
      if (entries.length >= 10000) throw Error("FILE_LIMIT");
      if (stat.isSymbolicLink())
        entries.push({
          path: rel,
          kind: "symlink",
          target: fs.readlinkSync(file),
        });
      else {
        if (!stat.isFile() || (total += stat.size) > 100 * 1024 * 1024)
          throw Error("FILE_LIMIT");
        const fd = fs.openSync(
          file,
          fs.constants.O_RDONLY |
            fs.constants.O_NOFOLLOW |
            fs.constants.O_NONBLOCK,
        );
        try {
          const before = fs.fstatSync(fd);
          if (!before.isFile() || before.size !== stat.size)
            throw Error("FILE_CHANGED");
          const bytes = fs.readFileSync(fd),
            after = fs.fstatSync(fd);
          if (
            bytes.length !== stat.size ||
            before.ctimeMs !== after.ctimeMs ||
            before.mtimeMs !== after.mtimeMs
          )
            throw Error("FILE_CHANGED");
          entries.push({
            path: rel,
            kind: "file",
            mode: stat.mode & 0o777,
            data: bytes.toString("base64"),
          });
        } finally {
          fs.closeSync(fd);
        }
      }
    }
  }
}
walk(root, "");
process.stdout.write(JSON.stringify({ version: 1, entries }));
