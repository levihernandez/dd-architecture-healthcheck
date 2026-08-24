import { Router } from 'express';
import { getDatabase } from '../../db/database';
import { parseUsageSummary, parseCostJson, buildProductBreakdown, buildProductCostHistory } from '../../assessment/cost-data';

const router = Router();

// GET /api/usage?orgId=...&scanRunId=...
router.get('/', (req, res, next) => {
  try {
    const { orgId, scanRunId } = req.query as { orgId?: string; scanRunId?: string };
    if (!orgId) { res.status(400).json({ error: 'orgId required' }); return; }

    const db = getDatabase();

    let row: { usage_json: string; cost_json: string | null; report_month: string; collected_at: string } | undefined;

    if (scanRunId) {
      row = db.prepare(
        'SELECT usage_json, cost_json, report_month, collected_at FROM usage_summary WHERE org_id=? AND scan_run_id=?'
      ).get(orgId, scanRunId) as typeof row;
    } else {
      row = db.prepare(`
        SELECT us.usage_json, us.cost_json, us.report_month, us.collected_at
        FROM usage_summary us
        JOIN scan_runs sr ON sr.id = us.scan_run_id
        WHERE us.org_id=? AND sr.status='completed'
        ORDER BY sr.completed_at DESC LIMIT 1
      `).get(orgId) as typeof row;
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
router.get('/product-cost-history', (req, res, next) => {
  try {
    const { orgId, productName } = req.query as { orgId?: string; productName?: string };
    if (!orgId) { res.status(400).json({ error: 'orgId required' }); return; }
    if (!productName) { res.status(400).json({ error: 'productName required' }); return; }

    const db = getDatabase();
    const rows = db.prepare(`
      SELECT us.report_month, us.cost_json
      FROM usage_summary us
      JOIN scan_runs sr ON sr.id = us.scan_run_id
      WHERE us.org_id = ? AND sr.status = 'completed' AND us.cost_json IS NOT NULL
      ORDER BY us.collected_at ASC
    `).all(orgId) as Array<{ report_month: string; cost_json: string | null }>;

    const history = buildProductCostHistory(rows, productName);
    res.json({ productName, history });
  } catch (err) { next(err); }
});

export default router;
