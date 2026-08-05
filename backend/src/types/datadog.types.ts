// Datadog API response types

export type DatadogSite =
  | 'datadoghq.com'
  | 'us3.datadoghq.com'
  | 'us5.datadoghq.com'
  | 'datadoghq.eu'
  | 'ap1.datadoghq.com'
  | 'ap2.datadoghq.com'
  | 'ddog-gov.com'
  | string;

export interface OrgConfig {
  id: string;
  name: string;
  site: DatadogSite;
  createdAt: string;
  updatedAt: string;
  sessionOnly: boolean;
  lastScanAt?: string;
  lastScanStatus?: 'success' | 'error' | 'running';
}

export interface DDHost {
  name: string;
  id?: number;
  aliases?: string[];
  apps?: string[];          // installed integration/check names, populated with with_apps=true
  tags_by_source?: Record<string, string[]>;
  mute?: boolean;
  host_name?: string;
  metrics?: {
    load?: number;
    iowait?: number;
    cpu?: number;
  };
  meta?: {
    platform?: string;
    agent_version?: string;
    gohai?: string;
  };
  agent_version?: string;
  aws_id?: string;
  aws_name?: string;
  gcp_id?: string;
  gcp_name?: string;
}

export interface DDRumApplication {
  id: string;
  type: string;
  attributes: {
    application_id?: string;
    name?: string;
    type?: string;         // browser | ios | android | flutter | react_native
    framework?: string;
    client_token?: string;
    created_at?: number;
    updated_at?: number;
    org_id?: number;
  };
}

export interface DDTag {
  key: string;
  value: string;
  source?: string;
}

export interface DDService {
  service_name: string;
  type?: string;
  resources?: DDServiceResource[];
  env?: string;
  version?: string;
  team?: string;
  last_updated?: string;
}

export interface DDServiceResource {
  name: string;
  type: string;
  tags?: string[];
}

export interface DDServiceCatalogEntry {
  type: string;
  id?: string;
  attributes: {
    schema?: {
      'dd-service': string;
      'dd-team'?: string;
      description?: string;
      tier?: string;
      lifecycle?: string;
      contacts?: Array<{ type: string; contact: string }>;
      tags?: string[];
    };
    tags?: string[];
    teams?: string[];
    integrations?: unknown;
    last_modified_at?: string;
    owner?: string;
  };
  relationships?: unknown;
}

export interface DDMonitor {
  id: number;
  name: string;
  type: string;
  query: string;
  message?: string;
  tags?: string[];
  options?: {
    notify_no_data?: boolean;
    no_data_timeframe?: number;
    renotify_interval?: number;
    escalation_message?: string;
    timeout_h?: number;
    silenced?: Record<string, number>;
    notify_audit?: boolean;
    locked?: boolean;
  };
  overall_state?: string;
  priority?: number | null;
  restricted_roles?: string[];
  created?: string;
  modified?: string;
  creator?: {
    email?: string;
    handle?: string;
    name?: string;
  };
}

export interface DDDashboard {
  id: string;
  title: string;
  description?: string;
  layout_type?: string;
  url?: string;
  created_at?: string;
  modified_at?: string;
  author_handle?: string;
  widgets?: DDWidget[];
  template_variables?: DDTemplateVariable[];
  tags?: string[];
  is_read_only?: boolean;
}

export interface DDWidget {
  id?: number;
  definition: {
    type: string;
    title?: string;
    requests?: unknown[];
    widgets?: DDWidget[];
  };
}

export interface DDTemplateVariable {
  name: string;
  prefix?: string;
  default?: string;
  available_values?: string[];
}

export interface DDSyntheticsTest {
  public_id: string;
  name: string;
  type: 'api' | 'browser' | 'mobile';
  status: string;
  tags?: string[];
  locations?: string[];
  message?: string;
  config?: {
    request?: unknown;
    assertions?: unknown[];
  };
  options?: {
    tick_every?: number;
    follow_redirects?: boolean;
    min_failure_duration?: number;
    min_location_failed?: number;
    monitor_options?: {
      notify_audit?: boolean;
      renotify_interval?: number;
      notify_no_data?: boolean;
    };
  };
  creator?: {
    email?: string;
    handle?: string;
    name?: string;
  };
  created_at?: string;
  modified_at?: string;
}

export interface DDLogsIndex {
  name: string;
  filter?: {
    query?: string;
  };
  exclusion_filters?: Array<{
    name: string;
    is_enabled: boolean;
    filter?: {
      query?: string;
      sample_rate?: number;
    };
  }>;
  num_retention_days?: number;
  daily_limit?: number;
  is_rate_limited?: boolean;
}

export interface DDLogsPipeline {
  id: string;
  name: string;
  is_enabled: boolean;
  is_read_only?: boolean;
  filter?: {
    query?: string;
  };
  processors?: DDLogsProcessor[];
  type?: string;
}

export interface DDLogsProcessor {
  type: string;
  name?: string;
  is_enabled?: boolean;
  sources?: string[];
  target?: string;
  is_replace_missing?: boolean;
}

export interface DDMetricMetadata {
  metric_name: string;
  type?: string;
  description?: string;
  unit?: string;
  integration?: string;
  per_unit?: string;
  short_name?: string;
  statsd_interval?: number;
}

export interface DDIntegration {
  name: string;
  configured?: boolean;
  enabled?: boolean;
  status?: string;
  version?: string;
  source_type_name?: string;
}

export interface DDCloudAccount {
  account_id?: string;
  account_name?: string;
  role_name?: string;
  access_key_id?: string;
  host_tags?: string[];
  filter_tags?: string[];
  excluded_regions?: string[];
  metrics_collection_enabled?: boolean;
  resource_collection_enabled?: boolean;
  cspm_resource_collection_enabled?: boolean;
  extended_resource_collection_enabled?: boolean;
  errors?: string[];
}

export interface DDSLO {
  id: string;
  name: string;
  type: 'metric' | 'monitor' | 'time_slice';
  description?: string;
  tags?: string[];
  thresholds?: Array<{
    target: number;
    target_display?: string;
    timeframe: string;
    warning?: number;
  }>;
  monitor_ids?: number[];
  creator?: {
    email?: string;
    handle?: string;
    name?: string;
  };
  created_at?: number;
  modified_at?: number;
}

export interface DDTeam {
  type: string;
  id: string;
  attributes: {
    name: string;
    handle: string;
    description?: string;
    user_count?: number;
    link_count?: number;
    created_at?: string;
    modified_at?: string;
    summary?: string;
  };
}

export interface DDUser {
  type: string;
  id: string;
  attributes: {
    name?: string;
    handle: string;
    email: string;
    title?: string;
    status?: string;
    disabled?: boolean;
    created_at?: string;
    modified_at?: string;
    service_account?: boolean;
    verified?: boolean;
    mfa_enabled?: boolean;
  };
  relationships?: {
    roles?: {
      data?: Array<{ type: string; id: string }>;
    };
    org?: {
      data?: { type: string; id: string };
    };
  };
}

export interface DDOrgSettings {
  data?: {
    type: string;
    id: string;
    attributes?: {
      description?: string;
      name?: string;
      public_id?: string;
      settings?: {
        private_widget_share?: boolean;
        saml?: { enabled?: boolean };
        saml_autocreate_access_role?: string;
        saml_autocreate_users_domains?: { enabled?: boolean; domains?: string[] };
        saml_can_be_enabled?: boolean;
        saml_idp_endpoint?: string;
        saml_idp_initiated_login?: { enabled?: boolean };
        saml_idp_metadata_uploaded?: boolean;
        saml_login_url?: string;
        saml_strict_mode?: { enabled?: boolean };
      };
    };
  };
}

export interface DDCollectionResult<T> {
  data: T[];
  status: 'success' | 'permission_denied' | 'not_available' | 'not_detected' | 'error';
  error?: string;
  endpoint: string;
  itemCount: number;
  collectedAt: string;
  requestCount: number;
  pageCount: number;
  truncated: boolean;
  rateLimitRemaining?: number;
}

export interface DDValidationResult {
  valid: boolean;
  orgName?: string;
  orgId?: string;
  error?: string;
}

// Deliberately loose — response shape confidence is moderate, not verified against
// live docs from this environment. Collectors parse these defensively with `?.`
// chaining and fallbacks; an unexpected field is a loss of detail, never a throw.

export interface DDSecurityFinding {
  id?: string;
  attributes?: {
    rule?: { category?: string; name?: string };
    category?: string;
    severity?: string;
    evaluation?: string;
    status?: string;
    resource_type?: string;
    resource?: { name?: string; type?: string };
  };
}

export interface DDCostConfig {
  id?: string;
  type?: string;
  attributes?: {
    account_id?: string;
    account_email?: string;
  };
}

export interface DDIncident {
  id?: string;
  attributes?: {
    title?: string;
    severity?: string;
    state?: string;
    fields?: { severity?: { value?: string } };
    created?: string;
    resolved?: string;
  };
}
