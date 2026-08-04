import { Router } from 'express';
import { z } from 'zod';
import { OrgRepository } from '../../db/repositories/org.repository';
import { createClient } from '../../datadog/client';
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

// GET /api/orgs
router.get('/', (req, res) => {
  const orgs = OrgRepository.findAll();
  res.json(orgs);
});

// GET /api/orgs/:id
router.get('/:id', (req, res, next) => {
  try {
    const org = OrgRepository.findById(req.params.id);
    if (!org) throw new AppError('Organization not found', 404);
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

    const org = OrgRepository.create(body);

    // Update with DD org info from validation
    if (validation.orgName || validation.orgId) {
      OrgRepository.updateScanStatus(org.id, 'pending', validation.orgName, validation.orgId);
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
    const existing = OrgRepository.findById(req.params.id);
    if (!existing) throw new AppError('Organization not found', 404);

    const updated = OrgRepository.update(req.params.id, body);
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
router.delete('/:id', (req, res, next) => {
  try {
    const deleted = OrgRepository.delete(req.params.id);
    if (!deleted) throw new AppError('Organization not found', 404);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/orgs/:id/validate
router.post('/:id/validate', async (req, res, next) => {
  try {
    const creds = OrgRepository.getCredentials(req.params.id);
    if (!creds) throw new AppError('Organization not found or credentials unavailable', 404);

    const client = createClient(creds);
    const result = await client.validate();
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
