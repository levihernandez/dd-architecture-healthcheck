import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { AppError } from '../middleware/error.middleware';
import { INDUSTRY_TEMPLATES, ORG_TEMPLATES } from '../../tagging/templates';

const router = Router();

const TagTemplateSchema = z.object({
  templateId: z.string().min(1).max(100),
});

// GET /api/orgs/:orgId/tag-template — the org's selected tagging template, or null if none selected.
router.get('/:orgId/tag-template', (req, res, next) => {
  try {
    const { orgId } = req.params;
    const db = getDatabase();
    const row = db.prepare('SELECT template_id, updated_at FROM org_tag_template WHERE org_id = ?')
      .get(orgId) as { template_id: string; updated_at: string } | undefined;
    if (!row) { res.json(null); return; }
    res.json({ templateId: row.template_id, updatedAt: row.updated_at });
  } catch (err) { next(err); }
});

// PUT /api/orgs/:orgId/tag-template — select a template to use across the app for this org.
router.put('/:orgId/tag-template', (req, res, next) => {
  try {
    const { orgId } = req.params;
    const parse = TagTemplateSchema.safeParse(req.body);
    if (!parse.success) throw new AppError('Invalid tag template selection', 400);

    const { templateId } = parse.data;
    const validIds = new Set([...INDUSTRY_TEMPLATES, ...ORG_TEMPLATES].map((t) => t.id));
    if (!validIds.has(templateId)) throw new AppError(`Unknown template id "${templateId}"`, 400);

    const db = getDatabase();
    const org = db.prepare('SELECT id FROM orgs WHERE id = ?').get(orgId);
    if (!org) throw new AppError('Org not found', 404);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO org_tag_template (id, org_id, template_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(org_id) DO UPDATE SET template_id = excluded.template_id, updated_at = excluded.updated_at
    `).run(uuidv4(), orgId, templateId, now);

    res.json({ templateId, updatedAt: now });
  } catch (err) { next(err); }
});

export default router;

/** Selected template id for an org, falling back to 'generic' if none has been chosen. */
export function getSelectedTemplateId(orgId: string): string {
  const db = getDatabase();
  const row = db.prepare('SELECT template_id FROM org_tag_template WHERE org_id = ?')
    .get(orgId) as { template_id: string } | undefined;
  return row?.template_id ?? 'generic';
}
