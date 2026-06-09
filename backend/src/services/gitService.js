import { simpleGit } from 'simple-git';
import logger from '../lib/logger.js';

const log = logger.child({ component: 'gitService' });

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
