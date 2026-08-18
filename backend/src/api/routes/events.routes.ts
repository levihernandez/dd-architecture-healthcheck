import { Router } from 'express';
import { getDatabase } from '../../db/database';

const router = Router();

interface EventStatRow {
  dimension: 'source' | 'service' | 'status';
  dimension_value: string;
  event_count: number;
}

// GET /api/events/stats?orgId=...&scanRunId=...
router.get('/stats', (req, res, next) => {
  try {
    const { orgId, scanRunId } = req.query as { orgId?: string; scanRunId?: string };
    if (!orgId) { res.status(400).json({ error: 'orgId required' }); return; }

    const db = getDatabase();

    let resolvedScanRunId = scanRunId;
    if (!resolvedScanRunId) {
      const latest = db.prepare(
        `SELECT id FROM scan_runs WHERE org_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1`
      ).get(orgId) as { id: string } | undefined;
      resolvedScanRunId = latest?.id;
    }

    if (!resolvedScanRunId) { res.json(null); return; }

    const rows = db.prepare(
      `SELECT dimension, dimension_value, event_count FROM event_stats WHERE org_id=? AND scan_run_id=? ORDER BY event_count DESC`
    ).all(orgId, resolvedScanRunId) as EventStatRow[];

    const computedAt = (db.prepare(
      `SELECT computed_at FROM event_stats WHERE org_id=? AND scan_run_id=? LIMIT 1`
    ).get(orgId, resolvedScanRunId) as { computed_at: string } | undefined)?.computed_at ?? null;

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
