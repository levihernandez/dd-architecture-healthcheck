import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { AppError } from '../middleware/error.middleware';
import { assertOrgAccess } from '../../auth/org-access';
import { INDUSTRY_TEMPLATES, ORG_TEMPLATES } from '../../tagging/templates';

const router = Router();

const TagTemplateSchema = z.object({
  templateId: z.string().min(1).max(100),
});

// GET /api/orgs/:orgId/tag-template — the org's selected tagging template, or null if none selected.
router.get('/:orgId/tag-template', async (req, res, next) => {
  try {
    const { orgId } = req.params;
    await assertOrgAccess(orgId, req.user!.id);
    const db = getDatabase();
    const row = await db<{ org_id: string; template_id: string; updated_at: string }>('org_tag_template')
      .select('template_id', 'updated_at')
      .where({ org_id: orgId })
      .first();
    if (!row) { res.json(null); return; }
    res.json({ templateId: row.template_id, updatedAt: row.updated_at });
  } catch (err) { next(err); }
});

// PUT /api/orgs/:orgId/tag-template — select a template to use across the app for this org.
router.put('/:orgId/tag-template', async (req, res, next) => {
  try {
    const { orgId } = req.params;
    await assertOrgAccess(orgId, req.user!.id);
    const parse = TagTemplateSchema.safeParse(req.body);
    if (!parse.success) throw new AppError('Invalid tag template selection', 400);

    const { templateId } = parse.data;
    const validIds = new Set([...INDUSTRY_TEMPLATES, ...ORG_TEMPLATES].map((t) => t.id));
    if (!validIds.has(templateId)) throw new AppError(`Unknown template id "${templateId}"`, 400);

    const db = getDatabase();
    const org = await db('orgs').select('id').where({ id: orgId }).first();
    if (!org) throw new AppError('Org not found', 404);

    const now = new Date().toISOString();
    await db('org_tag_template')
      .insert({ id: uuidv4(), org_id: orgId, template_id: templateId, updated_at: now })
      .onConflict('org_id')
      .merge(['template_id', 'updated_at']);

    res.json({ templateId, updatedAt: now });
  } catch (err) { next(err); }
});

export default router;

/** Selected template id for an org, falling back to 'generic' if none has been chosen. */
export async function getSelectedTemplateId(orgId: string): Promise<string> {
  const db = getDatabase();
  const row = await db<{ org_id: string; template_id: string }>('org_tag_template')
    .select('template_id')
    .where({ org_id: orgId })
    .first();
  return row?.template_id ?? 'generic';
}
