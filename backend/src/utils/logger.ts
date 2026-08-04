import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// In development: human-readable, includes trace context when available
// In production: JSON so the Datadog Agent picks up dd.trace_id / dd.span_id injected by dd-trace
const logFormat = printf(({ level, message, timestamp: ts, stack, dd }) => {
  const traceCtx = dd
    ? ` [trace_id=${(dd as Record<string, string>).trace_id ?? ''} span_id=${(dd as Record<string, string>).span_id ?? ''}]`
    : '';
  return `${ts} [${level}]${traceCtx}: ${stack || message}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    process.env.NODE_ENV !== 'production' ? colorize() : winston.format.json(),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});
