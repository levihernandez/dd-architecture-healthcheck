import { Router } from 'express';
import { getDatabase } from '../../db/database';
import { assertOrgAccess } from '../../auth/org-access';

const router = Router();

interface EventStatRow {
  dimension: 'source' | 'service' | 'status';
  dimension_value: string;
  event_count: number;
}

// GET /api/events/stats?orgId=...&scanRunId=...
router.get('/stats', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req.query as { orgId?: string; scanRunId?: string };
    if (!orgId) { res.status(400).json({ error: 'orgId required' }); return; }
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();

    let resolvedScanRunId = scanRunId;
    if (!resolvedScanRunId) {
      const latest = await db<{ id: string; org_id: string; status: string }>('scan_runs')
        .select('id')
        .where({ org_id: orgId, status: 'completed' })
        .orderBy('completed_at', 'desc')
        .first();
      resolvedScanRunId = latest?.id;
    }

    if (!resolvedScanRunId) { res.json(null); return; }

    const rows = await db<EventStatRow & { org_id: string; scan_run_id: string }>('event_stats')
      .select('dimension', 'dimension_value', 'event_count')
      .where({ org_id: orgId, scan_run_id: resolvedScanRunId })
      .orderBy('event_count', 'desc');

    const computedAtRow = await db<{ org_id: string; scan_run_id: string; computed_at: string }>('event_stats')
      .select('computed_at')
      .where({ org_id: orgId, scan_run_id: resolvedScanRunId })
      .first();
    const computedAt = computedAtRow?.computed_at ?? null;

    const bySource = rows.filter((r) => r.dimension === 'source').map((r) => ({ key: r.dimension_value, count: r.event_count }));
    const byService = rows.filter((r) => r.dimension === 'service').map((r) => ({ key: r.dimension_value, count: r.event_count }));
    const byStatus = rows.filter((r) => r.dimension === 'status').map((r) => ({ key: r.dimension_value, count: r.event_count }));

    const totalEvents = byStatus.reduce((sum, r) => sum + r.count, 0);

    res.json({
      scanRunId: resolvedScanRunId,
      computedAt,
      totalEvents,
      bySource,
      byService,
      byStatus,
    });
  } catch (err) { next(err); }
});

export default router;
