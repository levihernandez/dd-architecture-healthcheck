import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { CollectorResultSummary } from '../../types/api.types';

interface UsageSummaryResponse {
  usage?: Array<Record<string, unknown>>;
}

interface EstimatedCostResponse {
  data?: Array<{
    attributes?: {
      charges?: Array<{ charge_type: string; product_name: string; cost: number }>;
      date?: string;
      org_name?: string;
      public_id?: string;
    };
  }>;
}

export async function collectUsage(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting usage summary`);

  const now = new Date();
  const reportMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Fetch 3 months of history
  const startMonth = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const startMonthStr = `${startMonth.getFullYear()}-${String(startMonth.getMonth() + 1).padStart(2, '0')}`;

  // v1 usage summary — monthly aggregated usage per product
  const usageResult = await client.getRaw<UsageSummaryResponse>('/api/v1/usage/summary', {
    start_month: startMonthStr,
    end_month: reportMonth,
    include_org_details: true,
  });
  const usageData = usageResult.status === 'success' && usageResult.data ? usageResult.data : null;
  if (usageResult.status !== 'success') {
    logger.warn(`[${orgId}] Usage summary: ${usageResult.status} — ${usageResult.error ?? ''}`);
  }

  // v2 estimated cost — committed vs on-demand charges by product
  const costResult = await client.getRaw<EstimatedCostResponse>('/api/v2/usage/estimated_cost', {
    start_month: reportMonth,
    end_month: reportMonth,
  });
  const costData = costResult.status === 'success' && costResult.data ? costResult.data : null;
  if (costResult.status !== 'success') {
    logger.warn(`[${orgId}] Estimated cost: ${costResult.status} — ${costResult.error ?? ''}`);
  }

  const db = getDatabase();
  const collectedAt = new Date().toISOString();

  const usageJson = JSON.stringify(usageData ?? {});
  const costJson = costData ? JSON.stringify(costData) : null;

  // Composite-key upsert (org_id, scan_run_id) — done as explicit SELECT + conditional
  // INSERT/UPDATE inside a transaction rather than .onConflict([...]).merge(), since
  // composite conflict targets can behave inconsistently across knex versions/dialects.
  await db.transaction(async (trx) => {
    const existing = await trx('usage_summary')
      .select('id')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .first();

    if (existing) {
      await trx('usage_summary')
        .where({ org_id: orgId, scan_run_id: scanRunId })
        .update({
          report_month: reportMonth,
          usage_json: usageJson,
          cost_json: costJson,
          collected_at: collectedAt,
        });
    } else {
      await trx('usage_summary').insert({
        id: uuidv4(),
        org_id: orgId,
        scan_run_id: scanRunId,
        report_month: reportMonth,
        usage_json: usageJson,
        cost_json: costJson,
        collected_at: collectedAt,
      });
    }
  });

  const hasUsage = usageData !== null;
  return {
    collector: 'usage',
    status: hasUsage ? 'success' : 'not_detected',
    itemCount: hasUsage ? (usageData?.usage?.length ?? 0) : 0,
    durationMs: Date.now() - start,
  };
}
