import type { DatadogSite } from '../types';

export function ddBaseUrl(site: DatadogSite): string {
  if (site === 'datadoghq.com') return 'https://app.datadoghq.com';
  if (site === 'datadoghq.eu') return 'https://app.datadoghq.eu';
  if (site === 'ddog-gov.com') return 'https://app.ddog-gov.com';
  // us3, us5, ap1, ap2 use the subdomain directly
  return `https://${site}`;
}

const enc = (s: string) => encodeURIComponent(s);

export const ddUrl = {
  // Infrastructure
  infrastructure: (base: string) => `${base}/infrastructure`,
  host: (base: string, hostname: string) => `${base}/infrastructure?filter=host%3A${enc(hostname)}`,
  containers: (base: string) => `${base}/containers`,
  processes: (base: string) => `${base}/process`,
  hostWithoutTag: (base: string, tagKey: string) => `${base}/infrastructure?filter=-${enc(tagKey)}%3A*`,

  // Monitors
  monitor: (base: string, monitorId: string | number) => `${base}/monitors/${monitorId}`,
  monitorList: (base: string) => `${base}/monitors`,
  monitorListFiltered: (base: string, q: string) => `${base}/monitors?q=${enc(q)}`,
  mutedMonitors: (base: string) => `${base}/monitors?q=muted%3Atrue`,
  alertingMonitors: (base: string) => `${base}/monitors?q=status%3Aalert`,
  noDataMonitors: (base: string) => `${base}/monitors?q=status%3Ano_data`,
  slos: (base: string) => `${base}/slo`,
  slo: (base: string, sloId: string) => `${base}/slo?slo_id=${enc(sloId)}`,

  // Dashboards
  dashboard: (base: string, dashboardId: string) => `${base}/dashboard/${dashboardId}`,
  dashboardList: (base: string) => `${base}/dashboard/lists`,

  // APM
  service: (base: string, serviceName: string, env?: string) =>
    `${base}/apm/services/${enc(serviceName)}${env ? `?env=${enc(env)}` : ''}`,
  apmServices: (base: string) => `${base}/apm/services`,
  serviceCatalog: (base: string) => `${base}/service-catalog`,
  traces: (base: string) => `${base}/apm/traces`,
  traceQuery: (base: string, query: string) => `${base}/apm/traces?query=${enc(query)}`,

  // Logs
  logs: (base: string) => `${base}/logs`,
  logsQuery: (base: string, query: string) => `${base}/logs?query=${enc(query)}`,
  logIndex: (base: string, indexName?: string) =>
    indexName ? `${base}/logs?index=${enc(indexName)}` : `${base}/logs`,
  logsIndexes: (base: string) => `${base}/logs/pipelines/indexes`,
  logIndexConfig: (base: string, indexName: string) => `${base}/logs/pipelines/indexes/${enc(indexName)}`,
  logsPipelines: (base: string) => `${base}/logs/pipelines`,
  logsArchives: (base: string) => `${base}/logs/pipelines/archives`,
  logsMetrics: (base: string) => `${base}/logs/pipelines/generate-metrics`,

  // Synthetics
  syntheticTest: (base: string, testPublicId: string) => `${base}/synthetics/tests/${testPublicId}`,
  syntheticsTests: (base: string) => `${base}/synthetics/tests`,
  syntheticsPaused: (base: string) => `${base}/synthetics/tests?status=paused`,
  syntheticsAlerts: (base: string) => `${base}/synthetics/tests?status=alert`,

  // Network
  npm: (base: string) => `${base}/network`,
  ndm: (base: string) => `${base}/network/devices`,
  npmFlow: (base: string, query: string) => `${base}/network?query=${enc(query)}`,

  // Integrations / Cloud
  integrations: (base: string) => `${base}/integrations`,
  awsIntegration: (base: string) => `${base}/integrations/amazon-web-services`,
  gcpIntegration: (base: string) => `${base}/integrations/google-cloud-platform`,
  azureIntegration: (base: string) => `${base}/integrations/azure`,
  integrationSearch: (base: string, q: string) => `${base}/integrations?search=${enc(q)}`,

  // RUM
  rum: (base: string) => `${base}/rum/explorer`,
  rumApp: (base: string, appId: string) => `${base}/rum/explorer?applicationId=${enc(appId)}`,

  // Cost / Metrics
  metrics: (base: string) => `${base}/metric/explorer`,
  metricQuery: (base: string, metric: string) =>
    `${base}/metric/explorer?live=true&exp_metric=${enc(metric)}&exp_scope=*&exp_agg=avg`,
  metricsUsage: (base: string) => `${base}/account/usage`,

  // Security / Governance
  userManagement: (base: string) => `${base}/organization-settings/users`,
  roleManagement: (base: string) => `${base}/organization-settings/roles`,
  apiKeys: (base: string) => `${base}/organization-settings/api-keys`,
  samlConfig: (base: string) => `${base}/organization-settings/saml`,
  auditLogs: (base: string) => `${base}/audit-trail`,
};
