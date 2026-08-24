import { Router } from 'express';
import { generateAIAssessment, getStoredAssessment } from '../../ai/service';
import { ScanRepository } from '../../db/repositories/scan.repository';
import { assertOrgAccess } from '../../auth/org-access';
import { AppError } from '../middleware/error.middleware';

const router = Router();

// POST /api/ai/assess
router.post('/assess', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req.body;
    if (!orgId || !scanRunId) throw new AppError('orgId and scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const scan = await ScanRepository.findById(scanRunId);
    if (!scan || scan.orgId !== orgId) throw new AppError('Scan not found', 404);
    if (scan.status !== 'completed') throw new AppError('Scan must be completed before generating AI assessment', 400);

    const assessment = await generateAIAssessment(orgId, scanRunId);
    res.json(assessment);
  } catch (err) { next(err); }
});

// GET /api/ai/assess/:scanRunId
router.get('/assess/:scanRunId', async (req, res, next) => {
  try {
    const orgId = req.query.orgId as string;
    if (!orgId) throw new AppError('orgId query param required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const assessment = await getStoredAssessment(orgId, req.params.scanRunId);
    if (!assessment) throw new AppError('No AI assessment found for this scan', 404);

    res.json(assessment);
  } catch (err) { next(err); }
});

export default router;
