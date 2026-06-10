import { Router } from 'express';
import { getBranches } from '../services/gitService.js';
import { compareRepos } from '../services/compareService.js';
import logger from '../lib/logger.js';

const log = logger.child({ component: 'repos.route' });
const router = Router();

/**
 * GET /api/repos/branches?url=<repo-url>
 *
 * Returns the branch list for a remote repository.
 * Does not clone — uses git ls-remote which is fast on any public host.
 *
 * Query params:
 *   url (required) — remote git URL, e.g. https://github.com/owner/repo
 *
 * Response 200: { branches: string[] }
 * Response 400: { error: string }   — missing or empty url
 * Response 502: { error: string }   — git command failed (bad URL, no access, etc.)
 */
router.get('/branches', async (req, res) => {
  const { url } = req.query;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: '`url` query parameter is required' });
  }

  log.debug({ url }, 'Branch list request received');

  try {
    const branches = await getBranches(url.trim());
    return res.json({ branches });
  } catch (err) {
    log.warn({ url, err: err.message }, 'Failed to fetch branches');
    return res.status(502).json({
      error: `Could not fetch branches — check the URL and make sure the repository is public. (${err.message})`,
    });
  }
});

/**
 * POST /api/repos/compare
 *
 * Shallow-clones both repos (cached after first run) and returns a per-file
 * diff summary scoped to an optional sub-path.
 *
 * Body:
 *   repo1: { url, branch, path? }
 *   repo2: { url, branch, path? }
 *
 * Response 200: { files: Array<{ path: string, status: 'same'|'different'|'left-only'|'right-only' }> }
 * Response 400: { error: string }  — missing required fields
 * Response 502: { error: string }  — clone or filesystem failure
 */
router.post('/compare', async (req, res) => {
  const { repo1, repo2 } = req.body ?? {};

  if (!repo1?.url || !repo1?.branch || !repo2?.url || !repo2?.branch) {
    return res.status(400).json({
      error: 'Request body must include repo1 and repo2, each with url and branch',
    });
  }

  log.debug({ repo1, repo2 }, 'Compare request received');

  try {
    const files = await compareRepos(repo1, repo2);
    return res.json({ files });
  } catch (err) {
    log.error({ err: err.message, repo1, repo2 }, 'Comparison failed');
    return res.status(502).json({ error: err.message });
  }
});

export default router;
