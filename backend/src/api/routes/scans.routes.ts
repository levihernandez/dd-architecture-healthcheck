import { Router } from 'express';
import { z } from 'zod';
import { ScanRepository } from '../../db/repositories/scan.repository';
import { OrgRepository } from '../../db/repositories/org.repository';
import { ScorecardRepository } from '../../db/repositories/scorecard.repository';
import { FindingRepository } from '../../db/repositories/finding.repository';
import { runScan } from '../../datadog/scan-orchestrator';
import { compareScans } from '../../assessment/scan-comparison';
import { getDatabase } from '../../db/database';
import { assertOrgAccess } from '../../auth/org-access';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../../utils/logger';

const router = Router();

const ScanRequestSchema = z.object({
  // Not always a UUID — orgs are keyed by their detected Datadog org ID, which can be a
  // short alphanumeric slug (e.g. "ubshmbmhwxejn7vv") rather than a generated UUID.
  orgId: z.string().min(1),
  collectors: z.array(z.string()).optional(),
});

// A scan's URL only carries the scan id, not the org id, so ownership can only
// be checked after loading the scan — this fetches it and enforces access in
// one step. Throws the same 404 whether the scan doesn't exist or belongs to
// another user's org, so existence isn't leaked either way.
async function loadOwnedScan(scanId: string, userId: string) {
  const scan = await ScanRepository.findById(scanId);
  if (!scan) throw new AppError('Scan not found', 404);
  await assertOrgAccess(scan.orgId, userId);
  return scan;
}

// GET /api/scans?orgId=...
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.query.orgId as string | undefined;
    if (!orgId) throw new AppError('orgId query param required', 400);
    await assertOrgAccess(orgId, req.user!.id);
    const scans = await ScanRepository.findByOrg(orgId);
    res.json(scans);
  } catch (err) { next(err); }
});

// GET /api/scans/:id
router.get('/:id', async (req, res, next) => {
  try {
    const scan = await loadOwnedScan(req.params.id, req.user!.id);

    const scorecard = await ScorecardRepository.findByScan(scan.orgId, req.params.id);
    const topFindings = scorecard
      ? (await FindingRepository.findByScan(req.params.id, scan.orgId)).slice(0, 5)
      : [];

    res.json({ ...scan, scorecard, topFindings });
  } catch (err) { next(err); }
});

// POST /api/scans — start a new scan
router.post('/', async (req, res, next) => {
  try {
    const body = ScanRequestSchema.parse(req.body);
    await assertOrgAccess(body.orgId, req.user!.id);

    const org = await OrgRepository.findById(body.orgId);
    if (!org) throw new AppError('Organization not found', 404);

    const existingScan = (await ScanRepository.findByOrg(body.orgId, 1))[0];
    if (existingScan?.status === 'running') {
      throw new AppError('A scan is already running for this organization', 409);
    }

    const scan = await ScanRepository.create(body.orgId);
    logger.info(`Starting scan ${scan.id} for org ${body.orgId}`);

    // Run scan asynchronously
    setImmediate(async () => {
      try {
        await runScan(body.orgId, scan.id, body.collectors);
      } catch (err) {
        logger.error(`Scan ${scan.id} failed`, err);
        await ScanRepository.updateStatus(scan.id, 'failed', String(err));
        await OrgRepository.updateScanStatus(body.orgId, 'error');
      }
    });

    res.status(202).json(scan);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(`Validation error: ${err.errors.map((e) => e.message).join(', ')}`, 400));
    } else {
      next(err);
    }
  }
});

// GET /api/scans/:id/scorecard
router.get('/:id/scorecard', async (req, res, next) => {
  try {
    const scan = await loadOwnedScan(req.params.id, req.user!.id);

    const scorecard = await ScorecardRepository.findByScan(scan.orgId, req.params.id);
    if (!scorecard) throw new AppError('Scorecard not yet available', 404);

    res.json(scorecard);
  } catch (err) { next(err); }
});

// GET /api/scans/:id/compare?against=<scanId> — diffs this scan against
// `against`, or the org's immediately-previous completed scan if omitted.
router.get('/:id/compare', async (req, res, next) => {
  try {
    const currentScan = await loadOwnedScan(req.params.id, req.user!.id);

    const against = req.query.against as string | undefined;
    // `against` is caller-supplied — verify it belongs to the same org (and
    // therefore the same owner) rather than trusting it, or one user could
    // diff their scan against an arbitrary scan id from another org.
    const previousScan = against
      ? await ScanRepository.findById(against)
      : await ScanRepository.findPreviousCompleted(currentScan.orgId, currentScan.id);
    if (!previousScan || (against && previousScan.orgId !== currentScan.orgId)) {
      throw new AppError(
        against ? 'Comparison scan not found' : 'No earlier completed scan exists for this org yet',
        404
      );
    }

    const result = await compareScans(currentScan.orgId, previousScan.id, currentScan.id);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/scans/:id/findings
router.get('/:id/findings', async (req, res, next) => {
  try {
    const scan = await loadOwnedScan(req.params.id, req.user!.id);

    const { category, severity } = req.query;
    let findings = await FindingRepository.findByScan(req.params.id, scan.orgId);

    if (category) findings = findings.filter((f) => f.category === category);
    if (severity) findings = findings.filter((f) => f.severity === severity);

    res.json(findings);
  } catch (err) { next(err); }
});

// DELETE /api/scans/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const scan = await loadOwnedScan(req.params.id, req.user!.id);
    if (scan.status === 'running' || scan.status === 'pending') {
      throw new AppError('Cannot delete a scan that is still running', 409);
    }

    await ScanRepository.delete(req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /api/scans/:id/permissions
router.get('/:id/permissions', async (req, res, next) => {
  try {
    const scan = await loadOwnedScan(req.params.id, req.user!.id);

    const db = getDatabase();
    const permissions = await db('permissions_report')
      .where({ scan_run_id: req.params.id, org_id: scan.orgId })
      .orderBy('endpoint');

    res.json(permissions);
  } catch (err) { next(err); }
});

export default router;
