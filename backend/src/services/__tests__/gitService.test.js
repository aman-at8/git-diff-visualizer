import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be declared before the module under test is imported.
vi.mock('simple-git', () => ({ simpleGit: vi.fn() }));
vi.mock('fs-extra');

import { simpleGit } from 'simple-git';
import fs from 'fs-extra';
import { getBranches, ensureCloned } from '../gitService.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a raw git ls-remote string from a list of branch names. */
function lsRemoteOutput(...branches) {
  return branches.map((b, i) => `${'a'.repeat(40 - i)}\trefs/heads/${b}`).join('\n') + '\n';
}

// ── getBranches ───────────────────────────────────────────────────────────────

describe('getBranches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns branches sorted with main first', async () => {
    simpleGit.mockReturnValue({
      listRemote: vi.fn().mockResolvedValue(lsRemoteOutput('zebra', 'main', 'alpha')),
    });

    const result = await getBranches('https://github.com/owner/repo');

    expect(result[0]).toBe('main');
    expect(result).toEqual(['main', 'alpha', 'zebra']);
  });

  it('returns branches sorted with master first when there is no main', async () => {
    simpleGit.mockReturnValue({
      listRemote: vi.fn().mockResolvedValue(lsRemoteOutput('develop', 'master', 'feature-x')),
    });

    const result = await getBranches('https://github.com/owner/repo');

    expect(result[0]).toBe('master');
  });

  it('returns main before master when both exist', async () => {
    simpleGit.mockReturnValue({
      listRemote: vi.fn().mockResolvedValue(lsRemoteOutput('master', 'main')),
    });

    const result = await getBranches('https://github.com/owner/repo');

    expect(result[0]).toBe('main');
    expect(result[1]).toBe('master');
  });

  it('throws when the git command fails', async () => {
    simpleGit.mockReturnValue({
      listRemote: vi.fn().mockRejectedValue(new Error('repository not found')),
    });

    await expect(getBranches('https://github.com/bad/repo')).rejects.toThrow('repository not found');
  });
});

// ── ensureCloned ──────────────────────────────────────────────────────────────

describe('ensureCloned', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the cache directory immediately on a cache hit', async () => {
    // .git directory exists → valid clone already present
    fs.pathExists.mockResolvedValue(true);

    const dir = await ensureCloned('https://github.com/owner/repo', 'main');

    expect(dir).toContain('.gdv-cache');
    expect(simpleGit).not.toHaveBeenCalled();
  });

  it('runs git clone when the cache directory is missing', async () => {
    fs.pathExists.mockResolvedValue(false);
    fs.remove.mockResolvedValue();
    fs.ensureDir.mockResolvedValue();

    const mockClone = vi.fn().mockResolvedValue();
    simpleGit.mockReturnValue({ clone: mockClone });

    await ensureCloned('https://github.com/owner/repo', 'main');

    expect(mockClone).toHaveBeenCalledWith(
      'https://github.com/owner/repo',
      expect.stringContaining('.gdv-cache'),
      expect.arrayContaining(['--depth', '1', '--single-branch']),
    );
  });

  it('wipes and re-clones when .git is missing (broken partial clone)', async () => {
    // First call (checking .git) returns false → broken clone
    fs.pathExists.mockResolvedValue(false);
    fs.remove.mockResolvedValue();
    fs.ensureDir.mockResolvedValue();

    const mockClone = vi.fn().mockResolvedValue();
    simpleGit.mockReturnValue({ clone: mockClone });

    await ensureCloned('https://github.com/owner/repo', 'main');

    expect(fs.remove).toHaveBeenCalled();
    expect(mockClone).toHaveBeenCalledTimes(1);
  });

  it('produces a different cache key for different branches of the same repo', async () => {
    fs.pathExists.mockResolvedValue(true);

    const dirMain = await ensureCloned('https://github.com/owner/repo', 'main');
    const dirDev = await ensureCloned('https://github.com/owner/repo', 'develop');

    expect(dirMain).not.toBe(dirDev);
  });
});
