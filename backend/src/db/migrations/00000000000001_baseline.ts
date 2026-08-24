import type { Knex } from 'knex';

// Recreates the full current schema (pre-Knex, hand-rolled in schema.ts) as a
// single baseline migration. Already includes columns that were historically
// added via addColumnIfMissing (dashboards.is_read_only, service_catalog.link_count)
// since this migration represents the schema's final state, not its history.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('orgs', (t) => {
    t.text('id').primary();
    t.text('name').notNullable();
    t.text('site').notNullable();
    t.integer('session_only').notNullable().defaultTo(0);
    t.text('dd_org_name');
    t.text('dd_org_id');
    t.text('created_at').notNullable();
    t.text('updated_at').notNullable();
    t.text('last_scan_at');
    t.text('last_scan_status');
    t.text('notes');
  });

  await knex.schema.createTable('api_credentials_metadata', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('encrypted_api_key').notNullable();
    t.text('encrypted_app_key').notNullable();
    t.text('key_hint_api');
    t.text('key_hint_app');
    t.text('created_at').notNullable();
    t.text('updated_at').notNullable();
  });

  await knex.schema.createTable('scan_runs', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('status').notNullable().defaultTo('pending');
    t.text('started_at').notNullable();
    t.text('completed_at');
    t.text('error');
    t.text('collector_results');
    t.integer('finding_count').defaultTo(0);
    t.text('created_at').notNullable();
  });

  await knex.schema.createTable('resources', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('resource_type').notNullable();
    t.text('resource_id').notNullable();
    t.text('resource_name');
    t.text('source_endpoint');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.text('raw_json');
    t.unique(['org_id', 'resource_type', 'resource_id']);
  });

  await knex.schema.createTable('resource_tags', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('resource_type').notNullable();
    t.text('resource_id').notNullable();
    t.text('tag_key').notNullable();
    t.text('tag_value').notNullable();
    t.text('tag_source');
    t.index(['org_id', 'tag_key'], 'idx_resource_tags_key');
    t.index(['org_id', 'resource_type', 'resource_id'], 'idx_resource_tags_resource');
  });

  await knex.schema.createTable('hosts', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('host_name').notNullable();
    t.text('aliases');
    t.text('agent_version');
    t.text('platform');
    t.integer('has_env_tag').notNullable().defaultTo(0);
    t.integer('has_service_tag').notNullable().defaultTo(0);
    t.integer('has_version_tag').notNullable().defaultTo(0);
    t.integer('has_team_tag').notNullable().defaultTo(0);
    t.integer('tag_count').notNullable().defaultTo(0);
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'host_name']);
    t.index(['org_id'], 'idx_hosts_org');
    t.index(['org_id', 'scan_run_id'], 'idx_hosts_org_scan');
  });

  await knex.schema.createTable('services', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('service_name').notNullable();
    t.text('env');
    t.text('version');
    t.text('team');
    t.integer('has_service_catalog').notNullable().defaultTo(0);
    t.integer('has_monitor').notNullable().defaultTo(0);
    t.integer('has_slo').notNullable().defaultTo(0);
    t.integer('has_version_tag').notNullable().defaultTo(0);
    t.integer('has_owner').notNullable().defaultTo(0);
    t.integer('resource_count').defaultTo(0);
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'service_name', 'env']);
    t.index(['org_id'], 'idx_services_org');
    t.index(['org_id', 'scan_run_id'], 'idx_services_org_scan');
  });

  await knex.schema.createTable('service_catalog', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('service_name').notNullable();
    t.text('team');
    t.text('owner');
    t.text('tier');
    t.text('lifecycle');
    t.text('description');
    t.text('tags');
    t.text('contacts');
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.integer('link_count').notNullable().defaultTo(0);
    t.unique(['org_id', 'service_name']);
  });

  await knex.schema.createTable('monitors', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.integer('monitor_id').notNullable();
    t.text('monitor_name');
    t.text('monitor_type');
    t.text('overall_state');
    t.integer('priority');
    t.integer('has_notification').notNullable().defaultTo(0);
    t.integer('has_env_tag').notNullable().defaultTo(0);
    t.integer('has_service_tag').notNullable().defaultTo(0);
    t.integer('has_team_tag').notNullable().defaultTo(0);
    t.integer('is_muted').notNullable().defaultTo(0);
    t.text('muted_since');
    t.text('tags');
    t.text('message');
    t.text('created_at_dd');
    t.text('modified_at_dd');
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'monitor_id']);
    t.index(['org_id'], 'idx_monitors_org');
  });

  await knex.schema.createTable('dashboards', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('dashboard_id').notNullable();
    t.text('title');
    t.text('layout_type');
    t.integer('widget_count').defaultTo(0);
    t.integer('has_template_variables').notNullable().defaultTo(0);
    t.integer('template_variable_count').defaultTo(0);
    t.text('author_handle');
    t.integer('is_read_only').notNullable().defaultTo(0);
    t.text('tags');
    t.text('created_at_dd');
    t.text('modified_at_dd');
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'dashboard_id']);
  });

  await knex.schema.createTable('synthetics_tests', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('public_id').notNullable();
    t.text('test_name');
    t.text('test_type');
    t.text('status');
    t.integer('has_env_tag').notNullable().defaultTo(0);
    t.integer('has_service_tag').notNullable().defaultTo(0);
    t.integer('has_notification').notNullable().defaultTo(0);
    t.integer('location_count').defaultTo(0);
    t.text('tags');
    t.text('created_at_dd');
    t.text('modified_at_dd');
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'public_id']);
  });

  await knex.schema.createTable('logs_indexes', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('index_name').notNullable();
    t.text('filter_query');
    t.integer('retention_days');
    t.integer('daily_limit');
    t.integer('exclusion_filter_count').defaultTo(0);
    t.integer('is_rate_limited').notNullable().defaultTo(0);
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'index_name']);
  });

  await knex.schema.createTable('logs_pipelines', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('pipeline_id').notNullable();
    t.text('pipeline_name');
    t.integer('is_enabled').notNullable().defaultTo(0);
    t.text('filter_query');
    t.integer('processor_count').defaultTo(0);
    t.integer('is_read_only').notNullable().defaultTo(0);
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'pipeline_id']);
  });

  await knex.schema.createTable('integrations', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('integration_name').notNullable();
    t.text('integration_type');
    t.text('status');
    t.integer('is_configured').notNullable().defaultTo(0);
    t.integer('is_enabled').notNullable().defaultTo(0);
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'integration_name']);
  });

  await knex.schema.createTable('cloud_accounts', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('provider').notNullable();
    t.text('account_id');
    t.text('account_name');
    t.text('status');
    t.integer('metrics_enabled').notNullable().defaultTo(0);
    t.integer('resource_collection_enabled').notNullable().defaultTo(0);
    t.integer('has_errors').notNullable().defaultTo(0);
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'provider', 'account_id']);
  });

  await knex.schema.createTable('slos', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('slo_id').notNullable();
    t.text('slo_name');
    t.text('slo_type');
    t.text('tags');
    t.integer('has_env_tag').notNullable().defaultTo(0);
    t.integer('has_service_tag').notNullable().defaultTo(0);
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'slo_id']);
  });

  await knex.schema.createTable('product_usage_signals', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('product').notNullable();
    t.text('signal').notNullable();
    t.text('value');
    t.integer('detected').notNullable().defaultTo(0);
    t.text('evidence');
    t.text('checked_at').notNullable();
    t.unique(['org_id', 'product', 'signal']);
  });

  await knex.schema.createTable('findings', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('category').notNullable();
    t.text('rule_id').notNullable();
    t.text('rule_name').notNullable();
    t.text('severity').notNullable();
    t.text('title').notNullable();
    t.text('description').notNullable();
    t.text('impact');
    t.text('recommendation');
    t.integer('affected_count').notNullable().defaultTo(0);
    t.integer('total_count').notNullable().defaultTo(0);
    t.float('percentage').notNullable().defaultTo(0);
    t.text('affected_resources');
    t.text('evidence');
    t.text('tags');
    t.text('created_at').notNullable();
    t.index(['org_id', 'scan_run_id'], 'idx_findings_org');
    t.index(['org_id', 'category'], 'idx_findings_category');
    t.index(['severity'], 'idx_findings_severity');
  });

  await knex.schema.createTable('scorecards', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.float('overall_score').notNullable();
    t.text('overall_grade').notNullable();
    t.text('category_scores').notNullable();
    t.integer('total_findings').notNullable().defaultTo(0);
    t.integer('critical_findings').notNullable().defaultTo(0);
    t.integer('high_findings').notNullable().defaultTo(0);
    t.text('computed_at').notNullable();
    t.unique(['org_id', 'scan_run_id']);
  });

  await knex.schema.createTable('ai_assessments', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('provider').notNullable();
    t.text('model');
    t.text('prompt_hash');
    t.text('response').notNullable();
    t.integer('evidence_count').notNullable().defaultTo(0);
    t.text('generated_at').notNullable();
    t.unique(['org_id', 'scan_run_id']);
  });

  await knex.schema.createTable('ai_settings', (t) => {
    t.text('id').notNullable().defaultTo('default').primary();
    t.text('provider').notNullable().defaultTo('none');
    t.text('model');
    t.text('encrypted_api_key');
    t.text('base_url');
    t.text('updated_at').notNullable();
  });

  await knex.schema.createTable('permissions_report', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('endpoint').notNullable();
    t.text('status').notNullable();
    t.integer('status_code');
    t.text('error');
    t.text('tested_at').notNullable();
  });

  await knex.schema.createTable('teams', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('team_id').notNullable();
    t.text('team_name');
    t.text('handle');
    t.text('description');
    t.integer('user_count').notNullable().defaultTo(0);
    t.integer('link_count').notNullable().defaultTo(0);
    t.text('member_handles');
    t.text('link_labels');
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'team_id']);
    t.index(['org_id'], 'idx_teams_org');
  });

  await knex.schema.createTable('scorecard_rules', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('rule_id').notNullable();
    t.text('rule_name');
    t.text('description');
    t.integer('enabled').notNullable().defaultTo(0);
    t.integer('is_custom').notNullable().defaultTo(0);
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'rule_id']);
  });

  await knex.schema.createTable('scorecard_outcomes', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('rule_id');
    t.text('rule_name');
    t.text('service_name');
    t.text('state');
    t.text('remarks');
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'scan_run_id', 'rule_id', 'service_name']);
    t.index(['org_id', 'scan_run_id'], 'idx_scorecard_outcomes_org');
  });

  await knex.schema.createTable('tag_analysis', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('tag_key').notNullable();
    t.integer('unique_value_count').notNullable().defaultTo(0);
    t.integer('host_occurrence_count').notNullable().defaultTo(0);
    t.integer('service_occurrence_count').notNullable().defaultTo(0);
    t.integer('monitor_occurrence_count').notNullable().defaultTo(0);
    t.text('top_values');
    t.integer('is_standard_key').notNullable().defaultTo(0);
    t.text('suggested_mapping');
    t.text('computed_at').notNullable();
    t.unique(['org_id', 'scan_run_id', 'tag_key']);
  });

  await knex.schema.createTable('org_context', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('industry');
    t.text('business_description');
    t.text('tech_stack');
    t.text('cloud_providers');
    t.text('end_user_scale');
    t.text('transaction_volume');
    t.text('device_count');
    t.text('tier0_description');
    t.text('tier1_description');
    t.text('tier2_description');
    t.text('tier0_uptime_target');
    t.text('tier1_uptime_target');
    t.text('revenue_impact_per_hour');
    t.text('seasonality_description');
    t.text('peak_periods');
    t.text('compliance_frameworks');
    t.text('dev_team_size');
    t.integer('has_dedicated_sre').notNullable().defaultTo(0);
    t.text('oncall_setup');
    t.text('current_pain_points');
    t.text('dd_goals');
    t.text('additional_context');
    t.text('updated_at').notNullable();
    t.unique(['org_id']);
  });

  await knex.schema.createTable('org_tag_template', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('template_id').notNullable();
    t.text('updated_at').notNullable();
    t.unique(['org_id']);
  });

  await knex.schema.createTable('usage_summary', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('report_month').notNullable();
    t.text('usage_json').notNullable();
    t.text('cost_json');
    t.text('collected_at').notNullable();
    t.unique(['org_id', 'scan_run_id']);
  });

  await knex.schema.createTable('rum_applications', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('app_id').notNullable();
    t.text('app_name');
    t.text('app_type');
    t.text('framework');
    t.text('client_token_hint');
    t.text('created_at_dd');
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'app_id']);
  });

  await knex.schema.createTable('pricing_snapshots', (t) => {
    t.text('id').primary();
    t.text('captured_at').notNullable();
    t.text('source_url').notNullable();
    t.text('product').notNullable();
    t.text('tier');
    t.text('unit').notNullable();
    t.float('price').notNullable();
    t.text('raw_text');
    t.index(['product', 'captured_at'], 'idx_pricing_snapshots_product');
  });

  await knex.schema.createTable('sizing_snapshots', (t) => {
    t.text('id').primary();
    t.text('name').notNullable();
    t.text('created_at').notNullable();
    t.text('mode').notNullable();
    t.text('org_id').references('id').inTable('orgs').onDelete('SET NULL');
    t.text('org_name');
    t.float('total_list_price').notNullable();
    t.float('total_real_cost');
    t.integer('category_count').notNullable();
    t.text('cart_json').notNullable();
    t.text('state_json').notNullable();
    t.index(['created_at'], 'idx_sizing_snapshots_created');
  });

  await knex.schema.createTable('security_findings', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('finding_id').notNullable();
    t.text('category');
    t.text('severity');
    t.text('status');
    t.text('resource_type');
    t.text('resource_name');
    t.text('rule_name');
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'finding_id']);
    t.index(['org_id', 'scan_run_id'], 'idx_security_findings_org');
  });

  await knex.schema.createTable('cost_management_config', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('provider').notNullable();
    t.integer('configured').notNullable().defaultTo(0);
    t.integer('account_count').notNullable().defaultTo(0);
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'scan_run_id', 'provider']);
  });

  await knex.schema.createTable('incidents', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('incident_id').notNullable();
    t.text('title');
    t.text('severity');
    t.text('state');
    t.text('created_at_dd');
    t.text('resolved_at_dd');
    t.text('raw_json');
    t.text('first_seen').notNullable();
    t.text('last_seen').notNullable();
    t.unique(['org_id', 'incident_id']);
    t.index(['org_id', 'scan_run_id'], 'idx_incidents_org');
  });

  await knex.schema.createTable('event_stats', (t) => {
    t.text('id').primary();
    t.text('org_id').notNullable().references('id').inTable('orgs').onDelete('CASCADE');
    t.text('scan_run_id').notNullable().references('id').inTable('scan_runs').onDelete('CASCADE');
    t.text('dimension').notNullable();
    t.text('dimension_value').notNullable();
    t.integer('event_count').notNullable().defaultTo(0);
    t.text('computed_at').notNullable();
    t.unique(['org_id', 'scan_run_id', 'dimension', 'dimension_value']);
    t.index(['org_id', 'scan_run_id'], 'idx_event_stats_org');
  });

  await knex.schema.createTable('feature_flags', (t) => {
    t.text('key').primary();
    t.text('parent_key').references('key').inTable('feature_flags');
    t.text('node_type').notNullable();
    t.integer('enabled').notNullable().defaultTo(1);
    t.text('updated_at').notNullable();
    t.index(['parent_key'], 'idx_feature_flags_parent');
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'feature_flags', 'event_stats', 'incidents', 'cost_management_config',
    'security_findings', 'sizing_snapshots', 'pricing_snapshots', 'rum_applications',
    'usage_summary', 'org_tag_template', 'org_context', 'tag_analysis',
    'scorecard_outcomes', 'scorecard_rules', 'teams', 'permissions_report',
    'ai_settings', 'ai_assessments', 'scorecards', 'findings', 'product_usage_signals',
    'slos', 'cloud_accounts', 'integrations', 'logs_pipelines', 'logs_indexes',
    'synthetics_tests', 'dashboards', 'monitors', 'service_catalog', 'services',
    'hosts', 'resource_tags', 'resources', 'scan_runs', 'api_credentials_metadata',
    'orgs',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
