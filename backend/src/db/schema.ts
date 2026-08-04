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

  logger.info('Database schema migrations complete');
}
