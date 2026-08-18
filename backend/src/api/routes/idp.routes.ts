import { Router } from 'express';
import { AppError } from '../middleware/error.middleware';
import { analyzeIdpMaturity } from '../../assessment/idp-maturity';

const router = Router();

// GET /api/idp/maturity?orgId=&scanRunId= — Internal Developer Portal maturity
// check: teams, Software Catalog health, Scorecards, reliability, DORA metrics.
router.get('/maturity', (req, res, next) => {
  try {
    const orgId = req.query.orgId as string | undefined;
    const scanRunId = req.query.scanRunId as string | undefined;
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    res.json(analyzeIdpMaturity(orgId, scanRunId));
  } catch (err) { next(err); }
});

export default router;
