import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock both services — route tests verify HTTP behaviour only.
// Service logic is covered by the service unit tests.
vi.mock('../../services/gitService.js', () => ({ getBranches: vi.fn() }));
vi.mock('../../services/compareService.js', () => ({ compareRepos: vi.fn() }));

import { getBranches } from '../../services/gitService.js';
import { compareRepos } from '../../services/compareService.js';
import router from '../repos.js';

// Minimal Express app — no pino-http so logs don't pollute test output.
const app = express();
app.use(express.json());
app.use('/api/repos', router);

// ── GET /api/repos/branches ───────────────────────────────────────────────────

describe('GET /api/repos/branches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when url query param is missing', async () => {
    const res = await request(app).get('/api/repos/branches');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });

  it('returns 400 when url is an empty string', async () => {
    const res = await request(app).get('/api/repos/branches?url=');

    expect(res.status).toBe(400);
  });

  it('returns 200 with branch list on success', async () => {
    getBranches.mockResolvedValue(['main', 'develop']);

    const res = await request(app).get(
      '/api/repos/branches?url=https://github.com/owner/repo',
    );

    expect(res.status).toBe(200);
    expect(res.body.branches).toEqual(['main', 'develop']);
  });

  it('returns 502 when the git service throws', async () => {
    getBranches.mockRejectedValue(new Error('remote: Repository not found'));

    const res = await request(app).get(
      '/api/repos/branches?url=https://github.com/bad/repo',
    );

    expect(res.status).toBe(502);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /api/repos/compare ───────────────────────────────────────────────────

describe('POST /api/repos/compare', () => {
  beforeEach(() => vi.clearAllMocks());

  const validBody = {
    repo1: { url: 'https://github.com/owner/repo', branch: 'main' },
    repo2: { url: 'https://github.com/owner/fork', branch: 'main' },
  };

  it('returns 400 when repo1.branch is missing', async () => {
    const res = await request(app)
      .post('/api/repos/compare')
      .send({ repo1: { url: 'u' }, repo2: { url: 'u', branch: 'main' } });

    expect(res.status).toBe(400);
  });

  it('returns 400 when repo2.url is missing', async () => {
    const res = await request(app)
      .post('/api/repos/compare')
      .send({ repo1: { url: 'u', branch: 'main' }, repo2: { branch: 'main' } });

    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/api/repos/compare').send({});

    expect(res.status).toBe(400);
  });

  it('returns 200 with file list on success', async () => {
    compareRepos.mockResolvedValue([
      { path: 'src/index.js', status: 'different' },
      { path: 'README.md', status: 'same' },
    ]);

    const res = await request(app).post('/api/repos/compare').send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.files).toHaveLength(2);
    expect(res.body.files[0]).toEqual({ path: 'src/index.js', status: 'different' });
  });

  it('passes the optional path field through to the service', async () => {
    compareRepos.mockResolvedValue([]);

    await request(app)
      .post('/api/repos/compare')
      .send({ ...validBody, repo1: { ...validBody.repo1, path: 'src' }, repo2: { ...validBody.repo2, path: 'src' } });

    expect(compareRepos).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src' }),
      expect.objectContaining({ path: 'src' }),
    );
  });

  it('returns 502 when the compare service throws', async () => {
    compareRepos.mockRejectedValue(new Error('clone failed'));

    const res = await request(app).post('/api/repos/compare').send(validBody);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('clone failed');
  });
});
