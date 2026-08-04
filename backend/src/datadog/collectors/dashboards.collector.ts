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
    };
  }

  const db = getDatabase();
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO dashboards
      (id, org_id, scan_run_id, dashboard_id, title, layout_type, widget_count,
       has_template_variables, template_variable_count, author_handle, tags,
       created_at_dd, modified_at_dd, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction((dashboards: DDDashboard[]) => {
    for (const dash of dashboards) {
      const widgetCount = countWidgets(dash.widgets ?? []);
      const tvCount = dash.template_variables?.length ?? 0;

      insert.run(
        uuidv4(), orgId, scanRunId,
        dash.id, dash.title, dash.layout_type ?? null,
        widgetCount,
        tvCount > 0 ? 1 : 0,
        tvCount,
        dash.author_handle ?? null,
        JSON.stringify(dash.tags ?? []),
        dash.created_at ?? null,
        dash.modified_at ?? null,
        safeJsonSnapshot({ id: dash.id, title: dash.title, layout_type: dash.layout_type,
          template_variables: dash.template_variables, tags: dash.tags }),
        now, now
      );
    }
  });

  try { txn(listResult.data); } catch (err) {
    logger.error(`[${orgId}] Failed to store dashboard data`, err);
  }

  logger.info(`[${orgId}] Collected ${listResult.itemCount} dashboards in ${Date.now() - start}ms`);
  return {
    collector: 'dashboards',
    status: 'success',
    itemCount: listResult.itemCount,
    durationMs: Date.now() - start,
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
