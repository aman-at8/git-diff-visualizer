import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Supported log levels (controlled via LOG_LEVEL env var):
 *   error  – unhandled errors only
 *   warn   – recoverable issues
 *   info   – normal operational events (default in production)
 *   debug  – detailed flow tracing (default in development)
 *
 * In development: pretty-printed, colorized, human-readable timestamps.
 * In production:  structured JSON, one line per entry, ready for log aggregators.
 */
const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export default logger;
