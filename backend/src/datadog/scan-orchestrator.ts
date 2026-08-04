import { createClient } from './client';
import { OrgRepository } from '../db/repositories/org.repository';
import { ScanRepository } from '../db/repositories/scan.repository';
import { collectInfrastructure } from './collectors/infrastructure.collector';
import { collectAPM } from './collectors/apm.collector';
import { collectMonitors } from './collectors/monitors.collector';
import { collectDashboards } from './collectors/dashboards.collector';
import { collectSynthetics } from './collectors/synthetics.collector';
import { collectLogs } from './collectors/logs.collector';
import { collectIntegrations } from './collectors/integrations.collector';
import { collectServiceCatalog } from './collectors/service-catalog.collector';
import { collectSLOs } from './collectors/slos.collector';
import { collectGovernance } from './collectors/governance.collector';
import { collectRUM } from './collectors/rum.collector';
import { collectUsage } from './collectors/usage.collector';
import { runAssessment } from '../assessment/engine';
import { logger } from '../utils/logger';
import type { CollectorResultSummary } from '../types/api.types';

type CollectorFn = (client: ReturnType<typeof createClient>, orgId: string, scanRunId: string) => Promise<CollectorResultSummary>;

const ALL_COLLECTORS: Array<{ name: string; fn: CollectorFn }> = [
  { name: 'infrastructure', fn: collectInfrastructure },
  { name: 'apm', fn: collectAPM },
  { name: 'service_catalog', fn: collectServiceCatalog },
  { name: 'monitors', fn: collectMonitors },
  { name: 'dashboards', fn: collectDashboards },
  { name: 'synthetics', fn: collectSynthetics },
  { name: 'logs', fn: collectLogs },
  { name: 'integrations', fn: collectIntegrations },
  { name: 'slos', fn: collectSLOs },
  { name: 'governance', fn: collectGovernance },
  { name: 'rum', fn: collectRUM },
  { name: 'usage', fn: collectUsage },
];

export async function runScan(orgId: string, scanRunId: string, requestedCollectors?: string[]): Promise<void> {
  const creds = OrgRepository.getCredentials(orgId);
  if (!creds) {
    ScanRepository.updateStatus(scanRunId, 'failed', 'Could not retrieve credentials');
    return;
  }

  ScanRepository.updateStatus(scanRunId, 'running');

  const client = createClient({
    site: creds.site,
    apiKey: creds.apiKey,
    appKey: creds.appKey,
    timeoutMs: parseInt(process.env.DATADOG_REQUEST_TIMEOUT_MS ?? '30000'),
    maxRetries: parseInt(process.env.DATADOG_MAX_RETRIES ?? '3'),
  });

  const collectors = requestedCollectors
    ? ALL_COLLECTORS.filter((c) => requestedCollectors.includes(c.name))
    : ALL_COLLECTORS;

  const results: CollectorResultSummary[] = [];

  for (const collector of collectors) {
    try {
      logger.info(`[${orgId}] Running collector: ${collector.name}`);
      const result = await collector.fn(client, orgId, scanRunId);
      results.push(result);
      logger.info(`[${orgId}] Collector ${collector.name}: ${result.status} (${result.itemCount} items)`);
    } catch (err) {
      logger.error(`[${orgId}] Collector ${collector.name} threw an exception`, err);
      results.push({
        collector: collector.name,
        status: 'error',
        itemCount: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  ScanRepository.updateCollectorResults(scanRunId, results);

  // Run assessment engine
  try {
    logger.info(`[${orgId}] Running assessment engine`);
    const findingCount = await runAssessment(orgId, scanRunId);
    ScanRepository.updateFindingCount(scanRunId, findingCount);
    logger.info(`[${orgId}] Assessment complete: ${findingCount} findings`);
  } catch (err) {
    logger.error(`[${orgId}] Assessment engine error`, err);
  }

  const hasErrors = results.some((r) => r.status === 'error');
  ScanRepository.updateStatus(scanRunId, hasErrors ? 'completed' : 'completed');
  OrgRepository.updateScanStatus(orgId, 'success');

  logger.info(`[${orgId}] Scan ${scanRunId} complete`);
}
