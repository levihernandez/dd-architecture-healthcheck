import { Router } from 'express';
import { getDatabase } from '../../db/database';

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

    let usageMonths: Array<Record<string, unknown>> = [];
    let costCharges: Array<{ charge_type: string; product_name: string; cost: number }> = [];

    try {
      const parsed = JSON.parse(row.usage_json) as { usage?: Array<Record<string, unknown>> };
      usageMonths = parsed?.usage ?? [];
    } catch { /* empty */ }

    try {
      if (row.cost_json) {
        const parsed = JSON.parse(row.cost_json) as {
          data?: Array<{ attributes?: { charges?: Array<{ charge_type: string; product_name: string; cost: number }> } }>;
        };
        costCharges = parsed?.data?.flatMap(d => d.attributes?.charges ?? []) ?? [];
      }
    } catch { /* empty */ }

    // Latest month's usage (most recent entry)
    const latestUsage = usageMonths.at(-1) ?? {};

    // Build product summary from usage data
    const products = buildProductSummary(latestUsage, costCharges);

    res.json({
      reportMonth: row.report_month,
      collectedAt: row.collected_at,
      latestUsage,
      usageHistory: usageMonths,
      costCharges,
      products,
    });
  } catch (err) { next(err); }
});

type ProductSummary = {
  name: string;
  metricKey: string;
  value: number | null;
  unit: string;
  committedCost: number;
  onDemandCost: number;
  hasOnDemand: boolean;
};

function buildProductSummary(
  usage: Record<string, unknown>,
  charges: Array<{ charge_type: string; product_name: string; cost: number }>
): ProductSummary[] {
  const costMap: Record<string, { committed: number; on_demand: number }> = {};
  for (const c of charges) {
    const key = c.product_name.toLowerCase();
    if (!costMap[key]) costMap[key] = { committed: 0, on_demand: 0 };
    if (c.charge_type === 'on_demand') costMap[key].on_demand += c.cost;
    else costMap[key].committed += c.cost;
  }

  const getCost = (name: string) => {
    const key = name.toLowerCase();
    const match = Object.entries(costMap).find(([k]) => k.includes(key) || key.includes(k));
    return match ? match[1] : { committed: 0, on_demand: 0 };
  };

  const num = (k: string): number | null => {
    const v = usage[k];
    return typeof v === 'number' ? v : null;
  };

  const definitions: Array<{ name: string; metricKey: string; unit: string; costLookup: string }> = [
    { name: 'Infrastructure Hosts', metricKey: 'agent_host_top99p', unit: 'hosts (p99)', costLookup: 'infrastructure' },
    { name: 'APM Hosts', metricKey: 'apm_host_top99p', unit: 'hosts (p99)', costLookup: 'apm' },
    { name: 'Containers', metricKey: 'container_avg', unit: 'containers (avg)', costLookup: 'container' },
    { name: 'Custom Metrics', metricKey: 'custom_ts_avg', unit: 'timeseries (avg)', costLookup: 'custom metrics' },
    { name: 'Log Ingestion', metricKey: 'logs_ingested_bytes_sum', unit: 'bytes ingested', costLookup: 'log management' },
    { name: 'Synthetics API Tests', metricKey: 'synthetics_api_tests_sum', unit: 'test runs', costLookup: 'synthetics' },
    { name: 'Synthetics Browser Tests', metricKey: 'synthetics_browser_checks_burned_down_sum', unit: 'browser checks', costLookup: 'synthetics browser' },
    { name: 'RUM Sessions', metricKey: 'rum_total_sessions_sum', unit: 'sessions', costLookup: 'rum' },
    { name: 'Mobile RUM Sessions', metricKey: 'mobile_rum_total_sessions_sum', unit: 'sessions', costLookup: 'mobile rum' },
    { name: 'Network Monitoring', metricKey: 'npm_host_top99p', unit: 'hosts (p99)', costLookup: 'network' },
    { name: 'Profiling Hosts', metricKey: 'profiled_host_top99p', unit: 'hosts (p99)', costLookup: 'profiling' },
    { name: 'Sensitive Data Scanner', metricKey: 'sds_total_scanned_bytes_sum', unit: 'bytes scanned', costLookup: 'sensitive data' },
    { name: 'CSPM Hosts', metricKey: 'cloud_siem_events_agg_sum', unit: 'events', costLookup: 'cloud security' },
    { name: 'CI Pipeline Tests', metricKey: 'ci_visibility_pipeline_committers_hwm', unit: 'committers', costLookup: 'ci visibility' },
  ];

  return definitions
    .map(d => {
      const value = num(d.metricKey);
      const cost = getCost(d.costLookup);
      return {
        name: d.name,
        metricKey: d.metricKey,
        value,
        unit: d.unit,
        committedCost: cost.committed,
        onDemandCost: cost.on_demand,
        hasOnDemand: cost.on_demand > 0,
      };
    })
    .filter(p => p.value !== null || p.committedCost > 0 || p.onDemandCost > 0);
}

export default router;
