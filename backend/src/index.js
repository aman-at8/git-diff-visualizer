import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import logger from './lib/logger.js';
import reposRouter from './routes/repos.js';

const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

const app = express();

// Attach pino-http first so every request/response is logged with timing.
// In production this emits structured JSON; in dev it pretty-prints via pino-pretty.
app.use(pinoHttp({ logger }));

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/repos', reposRouter);

// ── Error handlers ────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Four-argument signature is required for Express to treat this as an error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  logger.info(
    { port: PORT, env: process.env.NODE_ENV || 'development', logLevel: logger.level },
    'Server started',
  );
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received — draining connections');
  server.close(() => {
    logger.info('All connections closed, process exiting');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
