import { Router } from 'express';
import { z } from 'zod';
import { ScanRepository } from '../../db/repositories/scan.repository';
import { OrgRepository } from '../../db/repositories/org.repository';
import { ScorecardRepository } from '../../db/repositories/scorecard.repository';
import { FindingRepository } from '../../db/repositories/finding.repository';
import { runScan } from '../../datadog/scan-orchestrator';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../../utils/logger';

const router = Router();

const ScanRequestSchema = z.object({
  orgId: z.string().uuid(),
  collectors: z.array(z.string()).optional(),
});

// GET /api/scans?orgId=...
router.get('/', (req, res, next) => {
  try {
    const orgId = req.query.orgId as string | undefined;
    if (!orgId) throw new AppError('orgId query param required', 400);
    const scans = ScanRepository.findByOrg(orgId);
    res.json(scans);
  } catch (err) { next(err); }
});

// GET /api/scans/:id
router.get('/:id', (req, res, next) => {
  try {
    const scan = ScanRepository.findById(req.params.id);
    if (!scan) throw new AppError('Scan not found', 404);

    const scorecard = ScorecardRepository.findByScan(scan.orgId, req.params.id);
    const topFindings = scorecard
      ? FindingRepository.findByScan(req.params.id, scan.orgId).slice(0, 5)
      : [];

    res.json({ ...scan, scorecard, topFindings });
  } catch (err) { next(err); }
});

// POST /api/scans — start a new scan
router.post('/', async (req, res, next) => {
  try {
    const body = ScanRequestSchema.parse(req.body);

    const org = OrgRepository.findById(body.orgId);
    if (!org) throw new AppError('Organization not found', 404);

    const existingScan = ScanRepository.findByOrg(body.orgId, 1)[0];
    if (existingScan?.status === 'running') {
      throw new AppError('A scan is already running for this organization', 409);
    }

    const scan = ScanRepository.create(body.orgId);
    logger.info(`Starting scan ${scan.id} for org ${body.orgId}`);

    // Run scan asynchronously
    setImmediate(async () => {
      try {
        await runScan(body.orgId, scan.id, body.collectors);
      } catch (err) {
        logger.error(`Scan ${scan.id} failed`, err);
        ScanRepository.updateStatus(scan.id, 'failed', String(err));
        OrgRepository.updateScanStatus(body.orgId, 'error');
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
router.get('/:id/scorecard', (req, res, next) => {
  try {
    const scan = ScanRepository.findById(req.params.id);
    if (!scan) throw new AppError('Scan not found', 404);

    const scorecard = ScorecardRepository.findByScan(scan.orgId, req.params.id);
    if (!scorecard) throw new AppError('Scorecard not yet available', 404);

    res.json(scorecard);
  } catch (err) { next(err); }
});

// GET /api/scans/:id/findings
router.get('/:id/findings', (req, res, next) => {
  try {
    const scan = ScanRepository.findById(req.params.id);
    if (!scan) throw new AppError('Scan not found', 404);

    const { category, severity } = req.query;
    let findings = FindingRepository.findByScan(req.params.id, scan.orgId);

    if (category) findings = findings.filter((f) => f.category === category);
    if (severity) findings = findings.filter((f) => f.severity === severity);

    res.json(findings);
  } catch (err) { next(err); }
});

// GET /api/scans/:id/permissions
router.get('/:id/permissions', (req, res, next) => {
  try {
    const scan = ScanRepository.findById(req.params.id);
    if (!scan) throw new AppError('Scan not found', 404);

    const { getDatabase } = require('../../db/database');
    const db = getDatabase();
    const permissions = db.prepare(
      'SELECT * FROM permissions_report WHERE scan_run_id = ? AND org_id = ? ORDER BY endpoint'
    ).all(req.params.id, scan.orgId);

    res.json(permissions);
  } catch (err) { next(err); }
});

export default router;
