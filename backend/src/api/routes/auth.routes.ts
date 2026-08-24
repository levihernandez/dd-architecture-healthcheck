import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { register, login, getUserById } from '../../auth/auth.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();

// Public self-service registration/login has no auth of its own yet, so it needs
// its own stricter limiter on top of the general /api limiter to blunt brute-force
// / credential-stuffing attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const body = RegisterSchema.parse(req.body);
    const result = await register(body.email, body.password, body.name);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(`Validation error: ${err.errors.map((e) => e.message).join(', ')}`, 400));
    } else {
      next(err);
    }
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const body = LoginSchema.parse(req.body);
    const result = await login(body.email, body.password);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(`Validation error: ${err.errors.map((e) => e.message).join(', ')}`, 400));
    } else {
      next(err);
    }
  }
});

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await getUserById(req.user!.id);
    if (!user) throw new AppError('User not found', 404);
    res.json(user);
  } catch (err) { next(err); }
});

export default router;
