import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');

export async function projectFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error('Use a project-relative file path.');
  }
  const file = path.resolve(root, relative);
  const rel = path.relative(root, file);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error('Path escapes project root.');
  }
  let current = root;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Refusing symlink in graph path.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return file;
}

export async function readProjectFile(root, relative) {
  return fs.readFile(await projectFile(root, relative), 'utf8');
}

export async function readJson(root, relative) {
  return JSON.parse(await readProjectFile(root, relative));
}

// One controller per run. A crashed writer leaves its lock for explicit inspection.
// No stale-lock guessing and no in-place JSON truncation.
export async function updateRun(root, relative, transform, { create = false } = {}) {
  const file = await projectFile(root, relative);
  const lock = await projectFile(root, `${relative}.lock`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Run is locked; inspect the writer before removing its .lock file.');
    throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    let previous;
    if (create) {
      try { await fs.lstat(file); throw new Error('Run file already exists; choose a new run path.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else previous = await readJson(root, relative);
    const next = await transform(previous);
    await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (create) {
      // Exclusive publication also protects a file created after the initial check.
      await fs.link(temporary, file);
    } else {
      // Refuse external edits made during validation, even if they ignored our lock.
      if (JSON.stringify(await readJson(root, relative)) !== JSON.stringify(previous)) {
        throw new Error('Run changed during update; retry from fresh status.');
      }
      await projectFile(root, relative);
      await fs.rename(temporary, file);
    }
    return next;
  } finally {
    await fs.rm(temporary, { force: true });
    await handle.close();
    await fs.unlink(lock);
  }
}
