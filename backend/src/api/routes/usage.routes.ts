import { Router } from 'express';
import { getDatabase } from '../../db/database';
import { assertOrgAccess } from '../../auth/org-access';
import { parseUsageSummary, parseCostJson, buildProductBreakdown, buildProductCostHistory } from '../../assessment/cost-data';

const router = Router();

// GET /api/usage?orgId=...&scanRunId=...
router.get('/', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req.query as { orgId?: string; scanRunId?: string };
    if (!orgId) { res.status(400).json({ error: 'orgId required' }); return; }
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();

    let row: { usage_json: string; cost_json: string | null; report_month: string; collected_at: string } | undefined;

    if (scanRunId) {
      row = await db('usage_summary')
        .select('usage_json', 'cost_json', 'report_month', 'collected_at')
        .where({ org_id: orgId, scan_run_id: scanRunId })
        .first() as typeof row;
    } else {
      row = await db('usage_summary as us')
        .join('scan_runs as sr', 'sr.id', 'us.scan_run_id')
        .select('us.usage_json', 'us.cost_json', 'us.report_month', 'us.collected_at')
        .where('us.org_id', orgId)
        .andWhere('sr.status', 'completed')
        .orderBy('sr.completed_at', 'desc')
        .first() as typeof row;
    }

    if (!row) { res.json(null); return; }

    const { usageHistory, latestUsage } = parseUsageSummary(row.usage_json);
    const costCharges = parseCostJson(row.cost_json);
    const products = buildProductBreakdown(latestUsage, costCharges);

    res.json({
      reportMonth: row.report_month,
      collectedAt: row.collected_at,
      latestUsage,
      usageHistory,
      costCharges,
      products,
    });
  } catch (err) { next(err); }
});

// GET /api/usage/product-cost-history?orgId=&productName= — this product's committed/
// on-demand cost for every distinct report_month this org has a completed scan for,
// so "activating" a product row can chart its own spend trend rather than just the
// current month's snapshot the main usage summary is limited to.
router.get('/product-cost-history', async (req, res, next) => {
  try {
    const { orgId, productName } = req.query as { orgId?: string; productName?: string };
    if (!orgId) { res.status(400).json({ error: 'orgId required' }); return; }
    if (!productName) { res.status(400).json({ error: 'productName required' }); return; }
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const rows = await db('usage_summary as us')
      .join('scan_runs as sr', 'sr.id', 'us.scan_run_id')
      .select('us.report_month', 'us.cost_json')
      .where('us.org_id', orgId)
      .andWhere('sr.status', 'completed')
      .whereNotNull('us.cost_json')
      .orderBy('us.collected_at', 'asc') as Array<{ report_month: string; cost_json: string | null }>;

    const history = buildProductCostHistory(rows, productName);
    res.json({ productName, history });
  } catch (err) { next(err); }
});

export default router;
