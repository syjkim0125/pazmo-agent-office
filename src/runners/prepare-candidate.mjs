// Trusted preparation only; never imports or executes candidate code.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const root = "/candidate",
  tree = root + "/tree";
// Docker copies may retain source ownership. CHOWN alone suffices to normalize
// this private VM copy; no DAC override, symlink traversal or candidate execution.
let visited = 0;
function ownForPreparation(file) {
  if (++visited > 30000) throw new Error("Candidate entry limit");
  fs.lchownSync(file, 0, 0);
  if (fs.lstatSync(file).isDirectory()) {
    fs.chmodSync(file, 0o700);
    for (const name of fs.readdirSync(file))
      ownForPreparation(file + "/" + name);
  }
}
ownForPreparation(root);
const bytes = fs.readFileSync(root + "/manifest.json");
if (hash(bytes) !== process.argv[1])
  throw new Error("Manifest digest mismatch");
const manifest = JSON.parse(bytes),
  expected = new Set(),
  directories = new Set([tree]);
if (
  manifest.version !== 1 ||
  !Array.isArray(manifest.entries) ||
  manifest.entries.length > 10000
)
  throw new Error("Invalid manifest");
let size = 0;
for (const e of manifest.entries) {
  if (
    typeof e.path !== "string" ||
    path.isAbsolute(e.path) ||
    e.path.split("/").some((p) => !p || p === "." || p === "..") ||
    expected.has(e.path)
  )
    throw new Error("Invalid path");
  expected.add(e.path);
  let parent = path.dirname(tree + "/" + e.path);
  while (parent !== root) {
    directories.add(parent);
    parent = path.dirname(parent);
  }
}
for (const directory of directories)
  if (!fs.lstatSync(directory).isDirectory())
    throw new Error("Unsafe directory");
for (const e of manifest.entries) {
  const file = tree + "/" + e.path,
    stat = fs.lstatSync(file);
  if (e.kind === "file") {
    size += stat.size;
    if (
      !stat.isFile() ||
      size > 100 * 1024 * 1024 ||
      stat.size !== e.size ||
      (stat.mode & 0o777) !== (e.mode & ~0o222) ||
      hash(fs.readFileSync(file)) !== e.sha256
    )
      throw new Error("File mismatch");
  } else if (e.kind === "symlink") {
    if (
      !stat.isSymbolicLink() ||
      fs.readlinkSync(file) !== e.target ||
      path.isAbsolute(e.target) ||
      !fs.realpathSync(file).startsWith(tree + "/")
    )
      throw new Error("Link mismatch");
  } else throw new Error("Unknown entry");
}
function walk(directory) {
  for (const e of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = directory + "/" + e.name;
    if (e.isDirectory()) {
      if (!directories.has(file)) throw new Error("Extra directory");
      walk(file);
    } else if (!expected.has(path.relative(tree, file)))
      throw new Error("Extra file");
  }
}
walk(tree);
if (process.argv[2] !== undefined && process.argv[2] !== "writable")
  throw new Error("Unknown preparation mode");
if (process.argv[2] === "writable")
  for (const e of manifest.entries)
    if (e.kind === "file") fs.chmodSync(tree + "/" + e.path, e.mode);
// Deepest paths first: after chown a mode-0700 directory is no longer root-readable.
const paths = [
  ...directories,
  ...manifest.entries.map((e) => tree + "/" + e.path),
  root + "/manifest.json",
  root,
];
paths.sort((a, b) => b.length - a.length);
for (const file of paths) fs.lchownSync(file, 1000, 1000);
console.log("CANDIDATE_VERIFIED");
