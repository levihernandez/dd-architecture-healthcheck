// Mock Datadog API responses for testing

import type { DDHost, DDMonitor, DDService, DDSyntheticsTest, DDLogsIndex } from '../../src/types/datadog.types';

export const mockHosts: DDHost[] = [
  {
    host_name: 'web-server-01',
    name: 'web-server-01',
    tags_by_source: {
      users: ['env:production', 'service:web', 'version:1.2.3', 'team:platform'],
    },
    agent_version: '7.50.0',
    meta: { platform: 'linux' },
  },
  {
    host_name: 'db-server-01',
    name: 'db-server-01',
    tags_by_source: {
      users: ['env:production', 'service:postgres'],
      // Missing version and team
    },
    agent_version: '7.50.0',
    meta: { platform: 'linux' },
  },
  {
    host_name: 'legacy-host-01',
    name: 'legacy-host-01',
    tags_by_source: {
      // Missing ALL standard tags
      users: ['role:worker', 'datacenter:us-east'],
    },
    agent_version: '6.20.0',
    meta: { platform: 'linux' },
  },
];

export const mockMonitors: DDMonitor[] = [
  {
    id: 1001,
    name: 'High Error Rate - web service',
    type: 'metric alert',
    query: 'avg(last_5m):sum:trace.web.request.errors{env:production,service:web} > 0.05',
    message: 'High error rate detected @pagerduty @slack-platform-alerts',
    tags: ['env:production', 'service:web', 'team:platform'],
    priority: 2,
    overall_state: 'OK',
    created: '2024-01-15T10:00:00Z',
    modified: '2024-03-01T12:00:00Z',
    options: { notify_no_data: false },
  },
  {
    id: 1002,
    name: 'Legacy Monitor - no tags',
    type: 'metric alert',
    query: 'avg(last_10m):avg:system.cpu.user{*} > 90',
    message: '', // No notification!
    tags: [], // No tags!
    priority: null, // No priority!
    overall_state: 'Alert',
    created: '2022-06-01T10:00:00Z',
    modified: '2022-06-01T10:00:00Z',
    options: { silenced: { '*': -1 } }, // Muted!
  },
  {
    id: 1003,
    name: 'DB Connection Pool',
    type: 'metric alert',
    query: 'avg(last_5m):avg:database.connections{env:production} > 100',
    message: 'DB connections high @pagerduty',
    tags: ['env:production'],
    priority: 1,
    overall_state: 'OK',
    created: '2024-02-01T10:00:00Z',
    modified: '2024-03-15T09:00:00Z',
  },
];

export const mockServices: DDService[] = [
  { service_name: 'web', env: 'production', version: '1.2.3', team: 'platform' },
  { service_name: 'api', env: 'production', version: '2.0.1', team: 'backend' },
  { service_name: 'worker', env: 'production' }, // Missing version and team
  { service_name: 'legacy-service', env: 'staging' }, // Missing version and team
];

export const mockSyntheticsTests: DDSyntheticsTest[] = [
  {
    public_id: 'abc-123-def',
    name: 'Homepage API Check',
    type: 'api',
    status: 'live',
    tags: ['env:production', 'service:web', 'team:platform'],
    locations: ['aws:us-east-1', 'aws:eu-west-1'],
    message: 'Homepage is down @pagerduty',
  },
  {
    public_id: 'xyz-456-ghi',
    name: 'Login Flow Browser Test',
    type: 'browser',
    status: 'live',
    tags: [], // No env or service tags
    locations: ['aws:us-east-1'], // Only 1 location
    message: '', // No notification
  },
];

export const mockLogsIndexes: DDLogsIndex[] = [
  {
    name: 'main',
    filter: { query: '*' }, // Catch-all - should flag
    num_retention_days: 15,
    daily_limit: 1000000,
    is_rate_limited: false,
    exclusion_filters: [],
  },
  {
    name: 'critical-errors',
    filter: { query: 'status:error service:api env:production' },
    num_retention_days: 30,
    daily_limit: 100000,
    is_rate_limited: false,
    exclusion_filters: [
      { name: 'exclude-health-checks', is_enabled: true, filter: { query: 'path:/health', sample_rate: 1 } },
    ],
  },
  {
    name: 'compliance',
    filter: { query: 'service:payments env:production' },
    num_retention_days: 365,
    daily_limit: 50000,
    is_rate_limited: true, // Rate limited - critical finding
  },
];

export const mockValidationResponse = {
  valid: true,
};

export const mockOrgResponse = {
  orgs: [{ name: 'ACME Corp', public_id: 'abc123def456' }],
};
