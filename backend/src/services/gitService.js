import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { simpleGit } from 'simple-git';
import fs from 'fs-extra';
import logger from '../lib/logger.js';

const log = logger.child({ component: 'gitService' });

// Resolved at module load — always points to <project-root>/.gdv-cache
// regardless of the cwd the server is started from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../../../.gdv-cache');

/**
 * Deterministic 16-char cache key for a (url, branch) pair.
 * Short enough to be readable in logs; collision-proof for practical use.
 */
function cacheKey(url, branch) {
  return crypto
    .createHash('sha256')
    .update(`${url}#${branch}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Returns all branches for a remote git repository without cloning it.
 * Uses `git ls-remote --heads` so it works on any public git host.
 *
 * Branches are sorted with `main` and `master` first, then alphabetically.
 *
 * @param {string} url - Remote repository URL (HTTPS or SSH)
 * @returns {Promise<string[]>} Sorted branch names
 */
export async function getBranches(url) {
  log.debug({ url }, 'Fetching remote branches');

  const git = simpleGit();
  const raw = await git.listRemote(['--heads', url]);

  const branches = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1].replace('refs/heads/', ''))
    .sort((a, b) => {
      if (a === 'main') return -1;
      if (b === 'main') return 1;
      if (a === 'master') return -1;
      if (b === 'master') return 1;
      return a.localeCompare(b);
    });

  log.info({ url, count: branches.length }, 'Branches fetched');
  return branches;
}

/**
 * Ensures a shallow clone of the given repo+branch exists in the local cache.
 * On a cache hit the clone directory is returned immediately — no network call.
 * On a miss (or a broken partial clone) a fresh `git clone --depth 1` is run.
 *
 * Cache lives at <project-root>/.gdv-cache/<key>/ and is gitignored.
 * Delete that directory to force a re-clone of all repos.
 *
 * @param {string} url    - Remote repository URL
 * @param {string} branch - Branch name to clone
 * @returns {Promise<string>} Absolute path to the cloned repository on disk
 */
export async function ensureCloned(url, branch) {
  const key = cacheKey(url, branch);
  const cloneDir = path.join(CACHE_DIR, key);

  // A valid clone has a .git directory. If it's missing the previous clone
  // was interrupted — remove the partial directory and re-clone.
  const isValid = await fs.pathExists(path.join(cloneDir, '.git'));

  if (isValid) {
    log.debug({ url, branch, key }, 'Cache hit — skipping clone');
    return cloneDir;
  }

  await fs.remove(cloneDir);
  await fs.ensureDir(CACHE_DIR);

  log.info({ url, branch, key, cloneDir }, 'Cloning repository (shallow, depth 1)');

  const git = simpleGit();
  await git.clone(url, cloneDir, [
    '--depth', '1',
    '--branch', branch,
    '--single-branch',   // only fetch the target branch — fastest possible clone
  ]);

  log.info({ url, branch, key }, 'Clone complete');
  return cloneDir;
}
