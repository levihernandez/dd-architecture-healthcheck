import type Database from 'better-sqlite3';
import { logger } from '../utils/logger';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Organizations / Datadog connections
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      site TEXT NOT NULL,
      session_only INTEGER NOT NULL DEFAULT 0,
      dd_org_name TEXT,
      dd_org_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_scan_at TEXT,
      last_scan_status TEXT,
      notes TEXT
    );

    -- Encrypted credential store (no raw keys)
    CREATE TABLE IF NOT EXISTS api_credentials_metadata (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      encrypted_api_key TEXT NOT NULL,
      encrypted_app_key TEXT NOT NULL,
      key_hint_api TEXT,
      key_hint_app TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Scan runs
    CREATE TABLE IF NOT EXISTS scan_runs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      collector_results TEXT,
      finding_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- Generic resource inventory
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT,
      source_endpoint TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      raw_json TEXT,
      UNIQUE(org_id, resource_type, resource_id)
    );

    -- Resource tags (normalized)
    CREATE TABLE IF NOT EXISTS resource_tags (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      tag_key TEXT NOT NULL,
      tag_value TEXT NOT NULL,
      tag_source TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_resource_tags_key ON resource_tags(org_id, tag_key);
    CREATE INDEX IF NOT EXISTS idx_resource_tags_resource ON resource_tags(org_id, resource_type, resource_id);

    -- Hosts / infrastructure
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      host_name TEXT NOT NULL,
      aliases TEXT,
      agent_version TEXT,
      platform TEXT,
      has_env_tag INTEGER NOT NULL DEFAULT 0,
      has_service_tag INTEGER NOT NULL DEFAULT 0,
      has_version_tag INTEGER NOT NULL DEFAULT 0,
      has_team_tag INTEGER NOT NULL DEFAULT 0,
      tag_count INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, host_name)
    );
    CREATE INDEX IF NOT EXISTS idx_hosts_org ON hosts(org_id);
    CREATE INDEX IF NOT EXISTS idx_hosts_org_scan ON hosts(org_id, scan_run_id);

    -- Services / APM
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      service_name TEXT NOT NULL,
      env TEXT,
      version TEXT,
      team TEXT,
      has_service_catalog INTEGER NOT NULL DEFAULT 0,
      has_monitor INTEGER NOT NULL DEFAULT 0,
      has_slo INTEGER NOT NULL DEFAULT 0,
      has_version_tag INTEGER NOT NULL DEFAULT 0,
      has_owner INTEGER NOT NULL DEFAULT 0,
      resource_count INTEGER DEFAULT 0,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, service_name, env)
    );
    CREATE INDEX IF NOT EXISTS idx_services_org ON services(org_id);
    CREATE INDEX IF NOT EXISTS idx_services_org_scan ON services(org_id, scan_run_id);

    -- Service catalog entries
    CREATE TABLE IF NOT EXISTS service_catalog (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      service_name TEXT NOT NULL,
      team TEXT,
      owner TEXT,
      tier TEXT,
      lifecycle TEXT,
      description TEXT,
      tags TEXT,
      contacts TEXT,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, service_name)
    );

    -- Monitors
    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      monitor_id INTEGER NOT NULL,
      monitor_name TEXT,
      monitor_type TEXT,
      overall_state TEXT,
      priority INTEGER,
      has_notification INTEGER NOT NULL DEFAULT 0,
      has_env_tag INTEGER NOT NULL DEFAULT 0,
      has_service_tag INTEGER NOT NULL DEFAULT 0,
      has_team_tag INTEGER NOT NULL DEFAULT 0,
      is_muted INTEGER NOT NULL DEFAULT 0,
      muted_since TEXT,
      tags TEXT,
      message TEXT,
      created_at_dd TEXT,
      modified_at_dd TEXT,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, monitor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_monitors_org ON monitors(org_id);

    -- Dashboards
    CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      dashboard_id TEXT NOT NULL,
      title TEXT,
      layout_type TEXT,
      widget_count INTEGER DEFAULT 0,
      has_template_variables INTEGER NOT NULL DEFAULT 0,
      template_variable_count INTEGER DEFAULT 0,
      author_handle TEXT,
      is_read_only INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      created_at_dd TEXT,
      modified_at_dd TEXT,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, dashboard_id)
    );

    -- Synthetics tests
    CREATE TABLE IF NOT EXISTS synthetics_tests (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      public_id TEXT NOT NULL,
      test_name TEXT,
      test_type TEXT,
      status TEXT,
      has_env_tag INTEGER NOT NULL DEFAULT 0,
      has_service_tag INTEGER NOT NULL DEFAULT 0,
      has_notification INTEGER NOT NULL DEFAULT 0,
      location_count INTEGER DEFAULT 0,
      tags TEXT,
      created_at_dd TEXT,
      modified_at_dd TEXT,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, public_id)
    );

    -- Logs indexes
    CREATE TABLE IF NOT EXISTS logs_indexes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      index_name TEXT NOT NULL,
      filter_query TEXT,
      retention_days INTEGER,
      daily_limit INTEGER,
      exclusion_filter_count INTEGER DEFAULT 0,
      is_rate_limited INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, index_name)
    );

    -- Logs pipelines
    CREATE TABLE IF NOT EXISTS logs_pipelines (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      pipeline_id TEXT NOT NULL,
      pipeline_name TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      filter_query TEXT,
      processor_count INTEGER DEFAULT 0,
      is_read_only INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, pipeline_id)
    );

    -- Integrations
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      integration_name TEXT NOT NULL,
      integration_type TEXT,
      status TEXT,
      is_configured INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, integration_name)
    );

    -- Cloud accounts (AWS/Azure/GCP)
    CREATE TABLE IF NOT EXISTS cloud_accounts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      account_id TEXT,
      account_name TEXT,
      status TEXT,
      metrics_enabled INTEGER NOT NULL DEFAULT 0,
      resource_collection_enabled INTEGER NOT NULL DEFAULT 0,
      has_errors INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, provider, account_id)
    );

    -- SLOs
    CREATE TABLE IF NOT EXISTS slos (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      slo_id TEXT NOT NULL,
      slo_name TEXT,
      slo_type TEXT,
      tags TEXT,
      has_env_tag INTEGER NOT NULL DEFAULT 0,
      has_service_tag INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, slo_id)
    );

    -- Product usage signals
    CREATE TABLE IF NOT EXISTS product_usage_signals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      product TEXT NOT NULL,
      signal TEXT NOT NULL,
      value TEXT,
      detected INTEGER NOT NULL DEFAULT 0,
      evidence TEXT,
      checked_at TEXT NOT NULL,
      UNIQUE(org_id, product, signal)
    );

    -- Findings
    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      impact TEXT,
      recommendation TEXT,
      affected_count INTEGER NOT NULL DEFAULT 0,
      total_count INTEGER NOT NULL DEFAULT 0,
      percentage REAL NOT NULL DEFAULT 0,
      affected_resources TEXT,
      evidence TEXT,
      tags TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_findings_org ON findings(org_id, scan_run_id);
    CREATE INDEX IF NOT EXISTS idx_findings_category ON findings(org_id, category);
    CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);

    -- Scorecards
    CREATE TABLE IF NOT EXISTS scorecards (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      overall_score REAL NOT NULL,
      overall_grade TEXT NOT NULL,
      category_scores TEXT NOT NULL,
      total_findings INTEGER NOT NULL DEFAULT 0,
      critical_findings INTEGER NOT NULL DEFAULT 0,
      high_findings INTEGER NOT NULL DEFAULT 0,
      computed_at TEXT NOT NULL,
      UNIQUE(org_id, scan_run_id)
    );

    -- AI assessments
    CREATE TABLE IF NOT EXISTS ai_assessments (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      model TEXT,
      prompt_hash TEXT,
      response TEXT NOT NULL,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      generated_at TEXT NOT NULL,
      UNIQUE(org_id, scan_run_id)
    );

    -- AI provider settings (singleton, id='default')
    CREATE TABLE IF NOT EXISTS ai_settings (
      id TEXT NOT NULL DEFAULT 'default' PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'none',
      model TEXT,
      encrypted_api_key TEXT,
      base_url TEXT,
      updated_at TEXT NOT NULL
    );

    -- Permissions audit
    CREATE TABLE IF NOT EXISTS permissions_report (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      error TEXT,
      tested_at TEXT NOT NULL
    );

    -- Teams (Internal Developer Portal): richer per-team detail than the
    -- generic 'team' rows in the resources table (which only mirror the raw list call).
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL,
      team_name TEXT,
      handle TEXT,
      description TEXT,
      user_count INTEGER NOT NULL DEFAULT 0,
      link_count INTEGER NOT NULL DEFAULT 0,
      member_handles TEXT,
      link_labels TEXT,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, team_id)
    );
    CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id);

    -- Scorecard rules (Software Catalog Scorecards)
    CREATE TABLE IF NOT EXISTS scorecard_rules (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      rule_id TEXT NOT NULL,
      rule_name TEXT,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      is_custom INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, rule_id)
    );

    -- Scorecard outcomes (per service, per rule)
    CREATE TABLE IF NOT EXISTS scorecard_outcomes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      rule_id TEXT,
      rule_name TEXT,
      service_name TEXT,
      state TEXT,
      remarks TEXT,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, scan_run_id, rule_id, service_name)
    );
    CREATE INDEX IF NOT EXISTS idx_scorecard_outcomes_org ON scorecard_outcomes(org_id, scan_run_id);

    -- Tag dictionary / analysis
    CREATE TABLE IF NOT EXISTS tag_analysis (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      tag_key TEXT NOT NULL,
      unique_value_count INTEGER NOT NULL DEFAULT 0,
      host_occurrence_count INTEGER NOT NULL DEFAULT 0,
      service_occurrence_count INTEGER NOT NULL DEFAULT 0,
      monitor_occurrence_count INTEGER NOT NULL DEFAULT 0,
      top_values TEXT,
      is_standard_key INTEGER NOT NULL DEFAULT 0,
      suggested_mapping TEXT,
      computed_at TEXT NOT NULL,
      UNIQUE(org_id, scan_run_id, tag_key)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS org_context (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      industry TEXT,
      business_description TEXT,
      tech_stack TEXT,
      cloud_providers TEXT,
      end_user_scale TEXT,
      transaction_volume TEXT,
      device_count TEXT,
      tier0_description TEXT,
      tier1_description TEXT,
      tier2_description TEXT,
      tier0_uptime_target TEXT,
      tier1_uptime_target TEXT,
      revenue_impact_per_hour TEXT,
      seasonality_description TEXT,
      peak_periods TEXT,
      compliance_frameworks TEXT,
      dev_team_size TEXT,
      has_dedicated_sre INTEGER NOT NULL DEFAULT 0,
      oncall_setup TEXT,
      current_pain_points TEXT,
      dd_goals TEXT,
      additional_context TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(org_id)
    );
  `);

  db.exec(`
    -- The org's selected tagging template (see backend/src/tagging/templates.ts) —
    -- once set, this template's tag tiers are used across the app instead of the
    -- generic baseline (Tag Explorer, Unified Tagging Scorecard, etc.).
    CREATE TABLE IF NOT EXISTS org_tag_template (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(org_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_summary (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      report_month TEXT NOT NULL,
      usage_json TEXT NOT NULL,
      cost_json TEXT,
      collected_at TEXT NOT NULL,
      UNIQUE(org_id, scan_run_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS rum_applications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL,
      app_name TEXT,
      app_type TEXT,
      framework TEXT,
      client_token_hint TEXT,
      created_at_dd TEXT,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, app_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS pricing_snapshots (
      id TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      source_url TEXT NOT NULL,
      product TEXT NOT NULL,
      tier TEXT,
      unit TEXT NOT NULL,
      price REAL NOT NULL,
      raw_text TEXT
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_product ON pricing_snapshots(product, captured_at);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sizing_snapshots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      mode TEXT NOT NULL,
      org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL,
      org_name TEXT,
      total_list_price REAL NOT NULL,
      total_real_cost REAL,
      category_count INTEGER NOT NULL,
      cart_json TEXT NOT NULL,
      state_json TEXT NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sizing_snapshots_created ON sizing_snapshots(created_at);`);

  db.exec(`
    -- Security findings (CSPM + Application Security + Cloud SIEM via the unified findings API)
    CREATE TABLE IF NOT EXISTS security_findings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      finding_id TEXT NOT NULL,
      category TEXT,
      severity TEXT,
      status TEXT,
      resource_type TEXT,
      resource_name TEXT,
      rule_name TEXT,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, finding_id)
    );
    CREATE INDEX IF NOT EXISTS idx_security_findings_org ON security_findings(org_id, scan_run_id);
  `);

  db.exec(`
    -- Cloud Cost Management configuration probe, per cloud provider
    CREATE TABLE IF NOT EXISTS cost_management_config (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      configured INTEGER NOT NULL DEFAULT 0,
      account_count INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, scan_run_id, provider)
    );
  `);

  db.exec(`
    -- Incident Management
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      incident_id TEXT NOT NULL,
      title TEXT,
      severity TEXT,
      state TEXT,
      created_at_dd TEXT,
      resolved_at_dd TEXT,
      raw_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(org_id, incident_id)
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_org ON incidents(org_id, scan_run_id);
  `);

  db.exec(`
    -- Event stats: counts from the Events Search API grouped by source_type_name,
    -- service, and status. Raw events aren't stored — only per-dimension counts,
    -- since event volume can be far larger than the other collected resources.
    CREATE TABLE IF NOT EXISTS event_stats (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      dimension TEXT NOT NULL,
      dimension_value TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      computed_at TEXT NOT NULL,
      UNIQUE(org_id, scan_run_id, dimension, dimension_value)
    );
    CREATE INDEX IF NOT EXISTS idx_event_stats_org ON event_stats(org_id, scan_run_id);
  `);

  db.exec(`
    -- Feature flag hierarchy (Scan -> Collector -> Rule/Page). Global, no org_id:
    -- these are admin toggles for this app instance, not per-org data.
    -- Effective state is always computed at read time (see FeatureFlagRepository):
    -- a disabled ancestor makes every descendant effectively disabled without ever
    -- overwriting the descendant's own stored preference.
    CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      parent_key TEXT REFERENCES feature_flags(key),
      node_type TEXT NOT NULL,        -- 'scan' | 'collector' | 'rule' | 'page'
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feature_flags_parent ON feature_flags(parent_key);
  `);

  addColumnIfMissing(db, 'dashboards', 'is_read_only', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'service_catalog', 'link_count', 'INTEGER NOT NULL DEFAULT 0');
  migrateOrgIdsToDatadogOrgId(db);

  logger.info('Database schema migrations complete');
}

// Idempotent ALTER TABLE ADD COLUMN, for columns introduced after a table's
// original CREATE TABLE IF NOT EXISTS — that guard alone is a no-op against
// databases that already have the table from an earlier app version.
function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (existing.some((col) => col.name === column)) return;
  logger.info(`[migration] Adding column ${table}.${column}`);
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Tables keyed by org_id, referencing orgs(id). Every one of these must be
// repointed when an org's primary key is rewritten to its detected Datadog org ID.
const ORG_SCOPED_TABLES = [
  'api_credentials_metadata', 'scan_runs', 'resources', 'resource_tags', 'hosts',
  'services', 'service_catalog', 'monitors', 'dashboards', 'synthetics_tests',
  'logs_indexes', 'logs_pipelines', 'integrations', 'cloud_accounts', 'slos',
  'product_usage_signals', 'findings', 'scorecards', 'ai_assessments',
  'permissions_report', 'tag_analysis', 'org_context', 'usage_summary',
  'rum_applications', 'org_ai_settings', 'org_tag_template',
  'teams', 'scorecard_rules', 'scorecard_outcomes', 'event_stats',
];

// One-time (per org), idempotent: rewrites an org's primary key from its
// originally-generated UUID to its real Datadog org ID once that ID has been
// detected via credential validation. No-op once id === dd_org_id.
function migrateOrgIdsToDatadogOrgId(db: Database.Database): void {
  const candidates = db.prepare(
    `SELECT id, dd_org_id, name FROM orgs WHERE dd_org_id IS NOT NULL AND dd_org_id != '' AND dd_org_id != id`
  ).all() as Array<{ id: string; dd_org_id: string; name: string }>;

  for (const org of candidates) {
    const collision = db.prepare('SELECT id FROM orgs WHERE id = ?').get(org.dd_org_id);
    if (collision) {
      logger.warn(`[migration] Skipping org id migration for "${org.name}" (${org.id}) — target id ${org.dd_org_id} already in use`);
      continue;
    }

    logger.info(`[migration] Migrating org "${org.name}" primary key ${org.id} -> ${org.dd_org_id} (detected Datadog org ID)`);

    // Immediate FK enforcement can't tolerate a parent-key rename mid-flight
    // (child rows would momentarily point at a nonexistent id either order),
    // so it's disabled for the duration of this single transaction only.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        for (const table of ORG_SCOPED_TABLES) {
          db.prepare(`UPDATE ${table} SET org_id = ? WHERE org_id = ?`).run(org.dd_org_id, org.id);
        }
        db.prepare('UPDATE orgs SET id = ? WHERE id = ?').run(org.dd_org_id, org.id);
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}
