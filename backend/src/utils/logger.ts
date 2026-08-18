import winston from 'winston';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const isProd = process.env.NODE_ENV === 'production';

// Shared base: stack traces expanded, consistent timestamp — applied before
// either the JSON or human-readable leaf format below.
const base = combine(errors({ stack: true }), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }));

// Human-readable line format — local dev console only. Structured logs (files,
// and console in production) use JSON so the Datadog Agent can parse them and
// pick up dd.trace_id / dd.span_id injected by dd-trace for trace correlation.
const humanFormat = printf(({ level, message, timestamp: ts, stack, dd }) => {
  const traceCtx = dd
    ? ` [trace_id=${(dd as Record<string, string>).trace_id ?? ''} span_id=${(dd as Record<string, string>).span_id ?? ''}]`
    : '';
  return `${ts} [${level}]${traceCtx}: ${stack || message}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: combine(base, json()),
  transports: [
    new winston.transports.Console({
      format: isProd ? combine(base, json()) : combine(base, colorize(), humanFormat),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      format: combine(base, json()),
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: combine(base, json()),
    }),
  ],
});
