// Registry of the 17 independent resource domains this skill can collect.
// Mirrors backend/src/datadog/collectors/*.ts one-to-one, so behavior stays
// faithful to the full app, but each domain is invoked as its own CLI call —
// never all 17 in a single process/API burst.

export const RESOURCES = {
  infrastructure: {
    label: 'Infrastructure (hosts)',
    why: 'Host inventory, cloud/agent tag coverage, muted/stale hosts.',
    heavy: true, // large orgs: thousands of hosts, paginated up to 300 pages
    fetch: (c) => c.getPaginated('/api/v1/hosts', { with_apps: true, with_mute_status: true, include_muted_hosts_data: true }, 300),
  },
  apm: {
    label: 'APM (services)',
    why: 'Traced services, span/error rates as a proxy for APM coverage.',
    heavy: true,
    fetch: (c) => c.getPaginated('/api/v1/services', {}, 100),
  },
  service_catalog: {
    label: 'Service Catalog',
    why: 'Registered service definitions — ownership/metadata completeness.',
    fetch: (c) => c.getV2Paginated('/api/v2/services/definitions'),
  },
  monitors: {
    label: 'Monitors',
    why: 'Alerting coverage, notification config, muted/no-data monitors.',
    heavy: true,
    fetch: (c) => c.getPaginated('/api/v1/monitor', { with_downtimes: true, group_states: 'all', page_size: 1000 }, 100),
  },
  dashboards: {
    label: 'Dashboards',
    why: 'Dashboard sprawl, ownership, staleness.',
    fetch: (c) => c.get('/api/v1/dashboard'),
  },
  synthetics: {
    label: 'Synthetics',
    why: 'Synthetic test coverage of critical user journeys.',
    fetch: (c) => c.get('/api/v1/synthetics/tests'),
  },
  logs: {
    label: 'Logs (indexes + pipelines)',
    why: 'Log index retention/exclusion filters and pipeline hygiene.',
    fetch: async (c) => ({
      indexes: await c.get('/api/v1/logs/config/indexes'),
      pipelines: await c.get('/api/v1/logs/config/pipelines'),
    }),
  },
  integrations: {
    label: 'Integrations (cloud + collaboration)',
    why: 'AWS/Azure/GCP account linkage, webhook/PagerDuty/Slack config.',
    fetch: async (c) => ({
      aws: await c.get('/api/v1/integration/aws'),
      azure: await c.get('/api/v1/integration/azure'),
      gcp: await c.get('/api/v1/integration/gcp'),
      webhooks: await c.get('/api/v1/integration/webhooks'),
      pagerduty: await c.get('/api/v1/integration/pagerduty'),
      slack: await c.get('/api/v1/integration/slack'),
    }),
  },
  slos: {
    label: 'SLOs',
    why: 'SLO coverage of critical services, error-budget hygiene.',
    fetch: (c) => c.get('/api/v1/slo', { limit: 1000 }),
  },
  governance: {
    label: 'Governance (teams/users/roles)',
    why: 'RBAC posture, team structure, org-wide settings.',
    heavy: true,
    fetch: async (c) => ({
      teams: await c.getV2Paginated('/api/v2/teams'),
      users: await c.getV2Paginated('/api/v2/users'),
      org: await c.get('/api/v1/org'),
      roles: await c.getV2Paginated('/api/v2/roles'),
    }),
  },
  idp: {
    label: 'Internal Developer Portal (scorecards)',
    why: 'Scorecard rule adoption and outcomes across services.',
    fetch: async (c) => ({
      rules: await c.getV2Paginated('/api/v2/scorecard/rules'),
      outcomes: await c.getV2Paginated('/api/v2/scorecard/outcomes'),
    }),
  },
  rum: {
    label: 'RUM',
    why: 'Real User Monitoring application coverage.',
    fetch: (c) => c.getV2Paginated('/api/v2/rum/applications'),
  },
  usage: {
    label: 'Usage & estimated cost',
    why: 'Billing usage summary and estimated cost by product.',
    fetch: async (c) => ({
      summary: await c.getRaw('/api/v1/usage/summary'),
      estimatedCost: await c.getRaw('/api/v2/usage/estimated_cost'),
    }),
  },
  security_findings: {
    label: 'Security findings (CSM/CSPM)',
    why: 'Cloud Security Management posture findings.',
    heavy: true,
    fetch: (c) => c.getV2Paginated('/api/v2/security_monitoring/findings', {}, 50),
  },
  cost_management: {
    label: 'Cloud Cost Management config',
    why: 'Whether AWS/Azure/GCP cost integrations are configured (probe, not usage data).',
    fetch: async (c) => ({
      aws: await c.get('/api/v2/cost/aws_cur_config'),
      azure: await c.get('/api/v2/cost/azure_uc_config'),
      gcp: await c.get('/api/v2/cost/gcp_usage_cost_config'),
    }),
  },
  incidents: {
    label: 'Incidents',
    why: 'Incident response usage — volume, resolution patterns.',
    fetch: (c) => c.getV2Paginated('/api/v2/incidents', {}, 50),
  },
  events: {
    label: 'Events',
    why: 'Recent event stream — deploys, alerts, custom events as activity signal.',
    heavy: true,
    fetch: (c) => c.getV2Paginated('/api/v2/events'),
  },
};

export const RESOURCE_IDS = Object.keys(RESOURCES);

export function requireResource(id) {
  const r = RESOURCES[id];
  if (!r) {
    throw new Error(`Unknown resource "${id}". Valid: ${RESOURCE_IDS.join(', ')}`);
  }
  return r;
}
