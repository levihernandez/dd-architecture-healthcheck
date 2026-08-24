import { Router } from 'express';
import { z } from 'zod';
import { OrgRepository } from '../../db/repositories/org.repository';
import { ScorecardRepository } from '../../db/repositories/scorecard.repository';
import { createClient } from '../../datadog/client';
import { assertOrgAccess } from '../../auth/org-access';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../../utils/logger';

const router = Router();

const DATADOG_SITES = [
  'datadoghq.com', 'us3.datadoghq.com', 'us5.datadoghq.com',
  'datadoghq.eu', 'ap1.datadoghq.com', 'ap2.datadoghq.com',
  'ddog-gov.com',
] as const;

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(100),
  site: z.string().min(1),
  apiKey: z.string().min(8),
  appKey: z.string().min(8),
  sessionOnly: z.boolean().optional().default(false),
});

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  site: z.string().optional(),
  apiKey: z.string().min(8).optional(),
  appKey: z.string().min(8).optional(),
});

// GET /api/orgs — only orgs this user connected
router.get('/', async (req, res, next) => {
  try {
    const orgs = await OrgRepository.findAll(req.user!.id);
    res.json(orgs);
  } catch (err) { next(err); }
});

// GET /api/orgs/overview — every org this user owns, plus its latest completed-scan
// scorecard. Must be registered before GET /:id or "overview" would be treated as an org id.
router.get('/overview', async (req, res, next) => {
  try {
    const orgs = await OrgRepository.findAll(req.user!.id);
    const scorecards = await ScorecardRepository.findAllLatest();
    const scorecardByOrg = new Map(scorecards.map((sc) => [sc.orgId, sc]));
    const overview = orgs.map((org) => ({
      ...org,
      scorecard: scorecardByOrg.get(org.id) ?? null,
    }));
    res.json(overview);
  } catch (err) { next(err); }
});

// GET /api/orgs/:id
router.get('/:id', async (req, res, next) => {
  try {
    await assertOrgAccess(req.params.id, req.user!.id);
    const org = await OrgRepository.findById(req.params.id);
    res.json(org);
  } catch (err) { next(err); }
});

// POST /api/orgs
router.post('/', async (req, res, next) => {
  try {
    const body = CreateOrgSchema.parse(req.body);

    // Validate credentials before saving
    const client = createClient({
      site: body.site,
      apiKey: body.apiKey,
      appKey: body.appKey,
    });

    const validation = await client.validate();
    if (!validation.valid) {
      throw new AppError(`Invalid Datadog credentials: ${validation.error ?? 'Unknown error'}`, 400);
    }

    // This Datadog org is already connected (its detected org ID is the row's primary
    // key) — treat this as a key rotation instead of creating a duplicate, empty-history org,
    // but only if the requesting user is the one who connected it originally. Another user
    // pointing their own keys at the same real Datadog org must not be able to take over
    // (or even detect) someone else's connection.
    if (validation.orgId) {
      const existing = await OrgRepository.findByIdUnscoped(validation.orgId);
      if (existing && existing.createdByUserId === req.user!.id) {
        const updated = (await OrgRepository.update(existing.id, { apiKey: body.apiKey, appKey: body.appKey }))!;
        logger.info(`Reconnected existing org: ${updated.name} (${updated.id}) — keys rotated, DD org: ${validation.orgName}`);
        res.status(200).json({ ...updated, ddOrgName: validation.orgName, ddOrgId: validation.orgId, reconnected: true });
        return;
      }
      if (existing) {
        throw new AppError('This Datadog organization is already connected by another account', 409);
      }
    }

    const org = await OrgRepository.create({ ...body, ddOrgId: validation.orgId, ddOrgName: validation.orgName }, req.user!.id);

    if (validation.orgName || validation.orgId) {
      await OrgRepository.updateScanStatus(org.id, 'pending', validation.orgName, validation.orgId);
    }

    logger.info(`Created org: ${org.name} (${org.id}) — DD org: ${validation.orgName}`);
    res.status(201).json({ ...org, ddOrgName: validation.orgName, ddOrgId: validation.orgId });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(`Validation error: ${err.errors.map((e) => e.message).join(', ')}`, 400));
    } else {
      next(err);
    }
  }
});

// PUT /api/orgs/:id
router.put('/:id', async (req, res, next) => {
  try {
    const body = UpdateOrgSchema.parse(req.body);
    await assertOrgAccess(req.params.id, req.user!.id);

    const updated = await OrgRepository.update(req.params.id, body);
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(`Validation error: ${err.errors.map((e) => e.message).join(', ')}`, 400));
    } else {
      next(err);
    }
  }
});

// DELETE /api/orgs/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await assertOrgAccess(req.params.id, req.user!.id);
    const deleted = await OrgRepository.delete(req.params.id);
    if (!deleted) throw new AppError('Organization not found', 404);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/orgs/:id/validate
router.post('/:id/validate', async (req, res, next) => {
  try {
    await assertOrgAccess(req.params.id, req.user!.id);
    const creds = await OrgRepository.getCredentials(req.params.id);
    if (!creds) throw new AppError('Organization not found or credentials unavailable', 404);

    const client = createClient(creds);
    const result = await client.validate();
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
