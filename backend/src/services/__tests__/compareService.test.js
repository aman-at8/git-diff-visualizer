import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock ensureCloned so no real git operations happen.
// Each test points the two "repos" at real temp directories it controls.
vi.mock('../gitService.js', () => ({ ensureCloned: vi.fn() }));

import { ensureCloned } from '../gitService.js';
import { compareRepos } from '../compareService.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

let dir1, dir2;

beforeEach(async () => {
  dir1 = await mkdtemp(join(tmpdir(), 'gdv-left-'));
  dir2 = await mkdtemp(join(tmpdir(), 'gdv-right-'));

  ensureCloned.mockImplementation(async (url) =>
    url === 'https://left' ? dir1 : dir2,
  );
});

afterEach(async () => {
  await rm(dir1, { recursive: true, force: true });
  await rm(dir2, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const repo1 = { url: 'https://left', branch: 'main' };
const repo2 = { url: 'https://right', branch: 'main' };

function statusMap(files) {
  return Object.fromEntries(files.map((f) => [f.path, f.status]));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('compareRepos — file statuses', () => {
  it('marks files with identical content as same', async () => {
    await writeFile(join(dir1, 'foo.js'), 'hello world');
    await writeFile(join(dir2, 'foo.js'), 'hello world');

    const files = await compareRepos(repo1, repo2);

    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ path: 'foo.js', status: 'same' });
  });

  it('marks files with different content as different', async () => {
    await writeFile(join(dir1, 'foo.js'), 'hello');
    await writeFile(join(dir2, 'foo.js'), 'world');

    const files = await compareRepos(repo1, repo2);

    expect(files[0]).toEqual({ path: 'foo.js', status: 'different' });
  });

  it('marks a file only in repo1 as left-only', async () => {
    await writeFile(join(dir1, 'only-left.js'), 'x');

    const files = await compareRepos(repo1, repo2);

    expect(files[0]).toEqual({ path: 'only-left.js', status: 'left-only' });
  });

  it('marks a file only in repo2 as right-only', async () => {
    await writeFile(join(dir2, 'only-right.js'), 'x');

    const files = await compareRepos(repo1, repo2);

    expect(files[0]).toEqual({ path: 'only-right.js', status: 'right-only' });
  });

  it('handles multiple files with mixed statuses correctly', async () => {
    await writeFile(join(dir1, 'same.js'), 'same');
    await writeFile(join(dir2, 'same.js'), 'same');
    await writeFile(join(dir1, 'changed.js'), 'old');
    await writeFile(join(dir2, 'changed.js'), 'new');
    await writeFile(join(dir1, 'removed.js'), 'gone');
    await writeFile(join(dir2, 'added.js'), 'new');

    const files = await compareRepos(repo1, repo2);
    const map = statusMap(files);

    expect(map['same.js']).toBe('same');
    expect(map['changed.js']).toBe('different');
    expect(map['removed.js']).toBe('left-only');
    expect(map['added.js']).toBe('right-only');
  });
});

describe('compareRepos — sort order', () => {
  it('returns different files before same files', async () => {
    await writeFile(join(dir1, 'a.js'), 'same');
    await writeFile(join(dir2, 'a.js'), 'same');
    await writeFile(join(dir1, 'b.js'), 'old');
    await writeFile(join(dir2, 'b.js'), 'new');

    const files = await compareRepos(repo1, repo2);

    expect(files[0].status).toBe('different');
    expect(files[1].status).toBe('same');
  });
});

describe('compareRepos — line ending normalisation', () => {
  it('treats CRLF and LF versions of the same file as same', async () => {
    await writeFile(join(dir1, 'file.txt'), 'hello\r\nworld\r\n');
    await writeFile(join(dir2, 'file.txt'), 'hello\nworld\n');

    const files = await compareRepos(repo1, repo2);

    expect(files[0].status).toBe('same');
  });
});

describe('compareRepos — nested directories', () => {
  it('walks subdirectories and returns paths relative to repo root', async () => {
    await mkdir(join(dir1, 'src'));
    await mkdir(join(dir2, 'src'));
    await writeFile(join(dir1, 'src', 'index.js'), 'v1');
    await writeFile(join(dir2, 'src', 'index.js'), 'v2');

    const files = await compareRepos(repo1, repo2);

    expect(files[0].path).toBe(join('src', 'index.js'));
    expect(files[0].status).toBe('different');
  });
});

describe('compareRepos — path filter', () => {
  it('scopes comparison to the given sub-path', async () => {
    await mkdir(join(dir1, 'src'));
    await mkdir(join(dir2, 'src'));
    await writeFile(join(dir1, 'root.js'), 'root');
    await writeFile(join(dir2, 'root.js'), 'root');
    await writeFile(join(dir1, 'src', 'app.js'), 'old');
    await writeFile(join(dir2, 'src', 'app.js'), 'new');

    const files = await compareRepos(
      { ...repo1, path: 'src' },
      { ...repo2, path: 'src' },
    );

    // root.js must not appear — it is outside the scoped path
    expect(files.every((f) => !f.path.includes('root.js'))).toBe(true);
    expect(files[0].path).toContain('app.js');
  });
});

describe('compareRepos — security', () => {
  it('rejects a path filter that would escape the repository root', async () => {
    await expect(
      compareRepos(
        { ...repo1, path: '../../../etc/passwd' },
        repo2,
      ),
    ).rejects.toThrow('Invalid path');
  });
});
