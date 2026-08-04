import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

export function errorMiddleware(
  err: Error & { statusCode?: number },
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  logger.error(`${req.method} ${req.path} — ${err.message}`, { stack: err.stack });

  res.status(statusCode).json({
    error: err.name || 'InternalError',
    message: statusCode === 500 ? 'An internal error occurred' : err.message,
    statusCode,
  });
}

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'AppError';
  }
}
