import path from 'path';
import crypto from 'crypto';
import fs from 'fs-extra';
import { ensureCloned } from './gitService.js';
import logger from '../lib/logger.js';

const log = logger.child({ component: 'compareService' });

// Status sort order — most actionable files surface first.
const STATUS_ORDER = { different: 0, 'left-only': 1, 'right-only': 2, same: 3 };

/**
 * SHA-256 of file text content, with line endings normalised to LF.
 * Prevents CRLF vs LF differences from showing as false positives.
 */
function hashText(content) {
  return crypto
    .createHash('sha256')
    .update(content.replace(/\r\n/g, '\n'))
    .digest('hex');
}

/** A file is binary if its first 512 bytes contain a null byte. */
function isBinary(buffer) {
  return buffer.slice(0, 512).includes(0);
}

/**
 * Recursively collects all file paths under a directory, relative to repoDir.
 * If filterPath points to a single file, that one path is returned directly.
 *
 * @param {string} repoDir    - Absolute path to the cloned repo root
 * @param {string} filterPath - Relative sub-path to scope the walk (optional)
 * @returns {Promise<string[]>} File paths relative to repoDir
 */
async function walkDir(repoDir, filterPath = '') {
  const searchPath = path.resolve(repoDir, filterPath);

  // Guard against path traversal (e.g. filterPath = '../../etc/passwd')
  if (!searchPath.startsWith(repoDir)) {
    throw new Error(`Invalid path "${filterPath}": must be within the repository`);
  }

  if (!(await fs.pathExists(searchPath))) return [];

  const stat = await fs.stat(searchPath);
  if (stat.isFile()) return [filterPath];

  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(path.relative(repoDir, fullPath));
      }
    }
  }

  await walk(searchPath);
  return files;
}

/**
 * Compares two remote repositories (optionally scoped to a sub-path) and
 * returns a per-file diff summary.
 *
 * Each entry has:
 *   path   — file path relative to the repo root (or the provided filterPath)
 *   status — "same" | "different" | "left-only" | "right-only"
 *
 * Results are sorted: different → left-only → right-only → same, then
 * alphabetically within each group.
 *
 * @param {{ url: string, branch: string, path?: string }} repo1
 * @param {{ url: string, branch: string, path?: string }} repo2
 * @returns {Promise<Array<{ path: string, status: string }>>}
 */
export async function compareRepos(repo1, repo2) {
  log.info(
    { repo1: { url: repo1.url, branch: repo1.branch }, repo2: { url: repo2.url, branch: repo2.branch } },
    'Starting comparison',
  );

  // Clone both repos in parallel — cache hits return immediately.
  const [dir1, dir2] = await Promise.all([
    ensureCloned(repo1.url, repo1.branch),
    ensureCloned(repo2.url, repo2.branch),
  ]);

  // Walk file trees in parallel, scoped to the requested path if given.
  const [files1, files2] = await Promise.all([
    walkDir(dir1, repo1.path || ''),
    walkDir(dir2, repo2.path || ''),
  ]);

  log.debug({ left: files1.length, right: files2.length }, 'File trees walked');

  const set1 = new Set(files1);
  const set2 = new Set(files2);
  const allFiles = [...new Set([...files1, ...files2])];

  const results = [];

  for (const file of allFiles) {
    const inLeft = set1.has(file);
    const inRight = set2.has(file);

    if (inLeft && inRight) {
      const [buf1, buf2] = await Promise.all([
        fs.readFile(path.join(dir1, file)).catch(() => null),
        fs.readFile(path.join(dir2, file)).catch(() => null),
      ]);

      if (buf1 === null || buf2 === null) {
        // Read error on one side — treat as different rather than crashing
        results.push({ path: file, status: 'different' });
        continue;
      }

      // Use byte comparison for binary files, hash-of-text for everything else.
      const status =
        isBinary(buf1) || isBinary(buf2)
          ? buf1.equals(buf2) ? 'same' : 'different'
          : hashText(buf1.toString('utf-8')) === hashText(buf2.toString('utf-8'))
            ? 'same'
            : 'different';

      results.push({ path: file, status });
    } else {
      results.push({ path: file, status: inLeft ? 'left-only' : 'right-only' });
    }
  }

  results.sort(
    (a, b) =>
      (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || a.path.localeCompare(b.path),
  );

  const summary = results.reduce(
    (acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }),
    {},
  );
  log.info({ ...summary, total: results.length }, 'Comparison complete');

  return results;
}
