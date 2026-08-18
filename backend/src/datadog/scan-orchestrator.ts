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
import { collectIdp } from './collectors/idp.collector';
import { collectRUM } from './collectors/rum.collector';
import { collectUsage } from './collectors/usage.collector';
import { collectSecurityFindings } from './collectors/security-findings.collector';
import { collectCostManagement } from './collectors/cost-management.collector';
import { collectIncidents } from './collectors/incidents.collector';
import { collectEvents } from './collectors/events.collector';
import { runAssessment } from '../assessment/engine';
import { FeatureFlagRepository } from '../feature-flags/repository';
import { logger } from '../utils/logger';
import type { CollectorResultSummary, CollectionLimits } from '../types/api.types';

type CollectorFn = (
  client: ReturnType<typeof createClient>,
  orgId: string,
  scanRunId: string,
  limits?: CollectionLimits
) => Promise<CollectorResultSummary>;

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
  { name: 'idp', fn: collectIdp },
  { name: 'rum', fn: collectRUM },
  { name: 'usage', fn: collectUsage },
  { name: 'security_findings', fn: collectSecurityFindings },
  { name: 'cost_management', fn: collectCostManagement },
  { name: 'incidents', fn: collectIncidents },
  { name: 'events', fn: collectEvents },
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

  // Feature-flag gate first: a collector disabled via the admin feature-flag tree
  // (or effectively disabled because its 'scan' ancestor is off) never runs,
  // regardless of what the caller explicitly requested.
  const flagEnabledCollectors = ALL_COLLECTORS.filter((c) => FeatureFlagRepository.isCollectorEnabled(c.name));

  const collectors = requestedCollectors
    ? flagEnabledCollectors.filter((c) => requestedCollectors.includes(c.name))
    : flagEnabledCollectors;

  const limits: CollectionLimits = {
    // 1000 pages * 1000 hosts/page = up to 1M hosts before truncating (was 300k) —
    // raised now that rate-limit pacing is tracked per-endpoint (see client.ts)
    // rather than a single global counter, so a long hosts pagination run no
    // longer risks starving/misleading unrelated collectors that run after it.
    maxPagesHosts: parseInt(process.env.DATADOG_MAX_PAGES_HOSTS ?? '1000'),
    maxPagesServices: parseInt(process.env.DATADOG_MAX_PAGES_SERVICES ?? '100'),
  };

  const results: CollectorResultSummary[] = [];

  for (const collector of collectors) {
    try {
      logger.info(`[${orgId}] Running collector: ${collector.name}`);
      const result = await collector.fn(client, orgId, scanRunId, limits);
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
