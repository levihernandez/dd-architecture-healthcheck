import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDDashboard } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

export async function collectDashboards(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting dashboards`);

  const listResult = await client.get<DDDashboard>('/api/v1/dashboard', {
    filter_shared: false,
  });

  if (listResult.status !== 'success') {
    return {
      collector: 'dashboards',
      status: listResult.status,
      itemCount: 0,
      error: listResult.error,
      durationMs: Date.now() - start,
      endpoint: listResult.endpoint,
      requestCount: listResult.requestCount,
      pageCount: listResult.pageCount,
      truncated: listResult.truncated,
      rateLimitRemaining: listResult.rateLimitRemaining,
    };
  }

  const db = getDatabase();
  const now = new Date().toISOString();

  try {
    await db.transaction(async (trx) => {
      for (const dash of listResult.data) {
        const widgetCount = countWidgets(dash.widgets ?? []);
        const tvCount = dash.template_variables?.length ?? 0;

        // dashboards has a composite unique constraint on (org_id, dashboard_id).
        // Reproduce INSERT OR REPLACE explicitly (select then conditional
        // insert/update) rather than onConflict().merge(), since composite-key
        // conflict targets can behave inconsistently across knex versions/dialects.
        const patch = {
          scan_run_id: scanRunId,
          dashboard_id: dash.id,
          title: dash.title,
          layout_type: dash.layout_type ?? null,
          widget_count: widgetCount,
          has_template_variables: tvCount > 0 ? 1 : 0,
          template_variable_count: tvCount,
          author_handle: dash.author_handle ?? null,
          is_read_only: dash.is_read_only ? 1 : 0,
          tags: JSON.stringify(dash.tags ?? []),
          created_at_dd: dash.created_at ?? null,
          modified_at_dd: dash.modified_at ?? null,
          raw_json: safeJsonSnapshot({ id: dash.id, title: dash.title, layout_type: dash.layout_type,
            template_variables: dash.template_variables, tags: dash.tags, is_read_only: dash.is_read_only }),
          last_seen: now,
        };

        const existing = await trx('dashboards').where({ org_id: orgId, dashboard_id: dash.id }).first();

        if (existing) {
          await trx('dashboards').where({ org_id: orgId, dashboard_id: dash.id }).update(patch);
        } else {
          await trx('dashboards').insert({
            id: uuidv4(),
            org_id: orgId,
            ...patch,
            first_seen: now,
          });
        }
      }
    });
  } catch (err) {
    logger.error(`[${orgId}] Failed to store dashboard data`, err);
  }

  logger.info(`[${orgId}] Collected ${listResult.itemCount} dashboards in ${Date.now() - start}ms`);
  return {
    collector: 'dashboards',
    status: 'success',
    itemCount: listResult.itemCount,
    durationMs: Date.now() - start,
    endpoint: listResult.endpoint,
    requestCount: listResult.requestCount,
    pageCount: listResult.pageCount,
    truncated: listResult.truncated,
    rateLimitRemaining: listResult.rateLimitRemaining,
  };
}

function countWidgets(widgets: DDDashboard['widgets']): number {
  if (!widgets) return 0;
  let count = 0;
  for (const w of widgets) {
    count++;
    if (w.definition?.widgets) count += countWidgets(w.definition.widgets);
  }
  return count;
}
