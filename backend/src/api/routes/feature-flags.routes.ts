import { Router } from 'express';
import { z } from 'zod';
import { FeatureFlagRepository } from '../../feature-flags/repository';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../../utils/logger';

const router = Router();

// GET /api/feature-flags — full nested tree with stored + computed effective state
router.get('/', async (_req, res, next) => {
  try {
    res.json(await FeatureFlagRepository.getTree());
  } catch (err) { next(err); }
});

const SetEnabledSchema = z.object({
  enabled: z.boolean(),
});

// PATCH /api/feature-flags/:key — toggle a single node's own stored preference
router.patch('/:key', async (req, res, next) => {
  try {
    const parse = SetEnabledSchema.safeParse(req.body);
    if (!parse.success) {
      throw new AppError(`Validation error: ${parse.error.errors.map((e) => e.message).join(', ')}`, 400);
    }

    await FeatureFlagRepository.setEnabled(req.params.key, parse.data.enabled);
    logger.info(`[feature-flags] ${req.params.key} -> enabled=${parse.data.enabled}`);
    res.json(await FeatureFlagRepository.getTree());
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Unknown feature flag key')) {
      next(new AppError(err.message, 404));
    } else {
      next(err);
    }
  }
});

export default router;
