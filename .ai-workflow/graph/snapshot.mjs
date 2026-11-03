import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { digest, projectFile } from './storage.mjs';

const execute = promisify(execFile);
const outputPaths = ['.ai-workflow/runs', '.ai-workflow/evidence', '.ai-workflow/approvals'];
const inside = (parent, file) => file === parent || file.startsWith(`${parent}/`);

export function canonicalStory(text) {
  return text.split(/\r?\n/).filter(line => !/^(?:Status:|Understanding gate \(G[134]\):|G4:)/i.test(line)).join('\n').trim();
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.isAbsolute(value)
    || value.split('/').includes('..') || path.posix.normalize(value) === '.') throw new Error('Snapshot inputs need project-relative paths without escapes.');
  return path.posix.normalize(value).replace(/\/$/, '');
}

export async function createSnapshot({ root, inputs, additionalInputs = [], story, exclude = [] } = {}) {
  root = await fs.realpath(root);
  if (inputs !== undefined && (!Array.isArray(inputs) || inputs.some(file => typeof file !== 'string'))) throw new Error('Snapshot inputs must be a path array.');
  const omitted = exclude.map(relativePath);
  const ignored = file => outputPaths.some(dir => inside(dir, file)) || omitted.includes(file) || file === story;
  const explicit = (inputs ?? []).map(relativePath);
  const required = additionalInputs.map(relativePath);
  if ([...explicit, ...required].some(file => ignored(file) || inside('.git', file))) throw new Error('Snapshot input overlaps an evidence/output or excluded path.');
  const git = async args => (await execute('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })).stdout;
  let repository = false;
  try { repository = (await git(['rev-parse', '--is-inside-work-tree'])).trim() === 'true'; } catch { /* A non-Git project must declare its inputs. */ }
  if (!repository && explicit.length === 0) throw new Error('Explicit snapshot inputs are required for a non-Git project.');
  let head = null;
  let index = [];
  let files = [...explicit, ...required];
  if (repository) {
    const discovered = (await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean);
    files = [...files, ...discovered];
    index = (await git(['ls-files', '--stage', '-z'])).split('\0').filter(Boolean)
      .filter(record => !ignored(record.slice(record.indexOf('\t') + 1))).sort();
    try { head = (await git(['rev-parse', '--verify', 'HEAD'])).trim(); } catch { /* An unborn branch has no HEAD. */ }
  }
  const entries = new Map();
  const collect = async relative => {
    relative = relativePath(relative);
    if (ignored(relative)) return;
    if (inside('.git', relative)) throw new Error('Cannot snapshot Git internal paths.');
    const file = path.join(root, relative);
    let info;
    try { info = await fs.lstat(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries.set(relative, { path: relative, kind: 'missing' });
      return;
    }
    if (info.isSymbolicLink()) {
      const target = await fs.readlink(file);
      const resolved = await fs.realpath(file);
      const rel = path.relative(root, resolved);
      if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Snapshot symlink escapes project root.');
      const targetInfo = await fs.stat(resolved);
      if (!targetInfo.isFile()) throw new Error('Snapshot directory symlinks are unsupported; list their real inputs.');
      entries.set(relative, { path: relative, kind: 'link', target, mode: targetInfo.mode & 0o777, hash: digest(await fs.readFile(resolved)) });
    } else if (info.isDirectory()) {
      for (const name of (await fs.readdir(file)).sort()) await collect(`${relative}/${name}`);
    } else if (info.isFile()) {
      // Reject symbolic ancestors even when the leaf itself is an ordinary file.
      await projectFile(root, relative);
      entries.set(relative, { path: relative, kind: 'file', mode: info.mode & 0o777, hash: digest(await fs.readFile(file)) });
    } else throw new Error(`Unsupported snapshot input: ${relative}`);
  };
  for (const relative of [...new Set(files)].sort()) await collect(relative);
  if (story) entries.set(story, { path: story, kind: 'story', hash: digest(canonicalStory(await fs.readFile(await projectFile(root, story), 'utf8'))) });
  const manifest = { version: 1, head, index, files: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)) };
  return { fingerprint: digest(JSON.stringify(manifest)), ...manifest };
}
