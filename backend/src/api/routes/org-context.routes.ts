import { Router } from 'express';
import { z } from 'zod';
import { getDatabase } from '../../db/database';
import { AppError } from '../middleware/error.middleware';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const OrgContextSchema = z.object({
  industry: z.string().max(100).nullish(),
  businessDescription: z.string().max(2000).nullish(),
  techStack: z.array(z.string()).nullish(),
  cloudProviders: z.array(z.string()).nullish(),
  endUserScale: z.string().max(50).nullish(),
  transactionVolume: z.string().max(50).nullish(),
  deviceCount: z.string().max(50).nullish(),
  tier0Description: z.string().max(500).nullish(),
  tier1Description: z.string().max(500).nullish(),
  tier2Description: z.string().max(500).nullish(),
  tier0UptimeTarget: z.string().max(20).nullish(),
  tier1UptimeTarget: z.string().max(20).nullish(),
  revenueImpactPerHour: z.string().max(50).nullish(),
  seasonalityDescription: z.string().max(1000).nullish(),
  peakPeriods: z.array(z.string()).nullish(),
  complianceFrameworks: z.array(z.string()).nullish(),
  devTeamSize: z.string().max(20).nullish(),
  hasDedicatedSRE: z.boolean().nullish(),
  oncallSetup: z.string().max(50).nullish(),
  currentPainPoints: z.array(z.string()).nullish(),
  ddGoals: z.array(z.string()).nullish(),
  additionalContext: z.string().max(3000).nullish(),
  updatedAt: z.string().nullish(),
});

// GET /api/orgs/:orgId/context
router.get('/:orgId/context', (req, res, next) => {
  try {
    const { orgId } = req.params;
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM org_context WHERE org_id = ?').get(orgId) as Record<string, unknown> | undefined;
    if (!row) { res.json(null); return; }
    res.json(deserialize(row));
  } catch (err) { next(err); }
});

// PUT /api/orgs/:orgId/context
router.put('/:orgId/context', (req, res, next) => {
  try {
    const { orgId } = req.params;
    const parse = OrgContextSchema.safeParse(req.body);
    if (!parse.success) throw new AppError('Invalid context data', 400);

    const db = getDatabase();
    const org = db.prepare('SELECT id FROM orgs WHERE id = ?').get(orgId);
    if (!org) throw new AppError('Org not found', 404);

    const d = parse.data;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO org_context (
        id, org_id, industry, business_description, tech_stack, cloud_providers,
        end_user_scale, transaction_volume, device_count,
        tier0_description, tier1_description, tier2_description,
        tier0_uptime_target, tier1_uptime_target, revenue_impact_per_hour,
        seasonality_description, peak_periods, compliance_frameworks,
        dev_team_size, has_dedicated_sre, oncall_setup,
        current_pain_points, dd_goals, additional_context, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(org_id) DO UPDATE SET
        industry=excluded.industry, business_description=excluded.business_description,
        tech_stack=excluded.tech_stack, cloud_providers=excluded.cloud_providers,
        end_user_scale=excluded.end_user_scale, transaction_volume=excluded.transaction_volume,
        device_count=excluded.device_count,
        tier0_description=excluded.tier0_description, tier1_description=excluded.tier1_description,
        tier2_description=excluded.tier2_description,
        tier0_uptime_target=excluded.tier0_uptime_target, tier1_uptime_target=excluded.tier1_uptime_target,
        revenue_impact_per_hour=excluded.revenue_impact_per_hour,
        seasonality_description=excluded.seasonality_description, peak_periods=excluded.peak_periods,
        compliance_frameworks=excluded.compliance_frameworks,
        dev_team_size=excluded.dev_team_size, has_dedicated_sre=excluded.has_dedicated_sre,
        oncall_setup=excluded.oncall_setup,
        current_pain_points=excluded.current_pain_points, dd_goals=excluded.dd_goals,
        additional_context=excluded.additional_context, updated_at=excluded.updated_at
    `).run(
      uuidv4(), orgId,
      d.industry ?? null, d.businessDescription ?? null,
      d.techStack ? JSON.stringify(d.techStack) : null,
      d.cloudProviders ? JSON.stringify(d.cloudProviders) : null,
      d.endUserScale ?? null, d.transactionVolume ?? null, d.deviceCount ?? null,
      d.tier0Description ?? null, d.tier1Description ?? null, d.tier2Description ?? null,
      d.tier0UptimeTarget ?? null, d.tier1UptimeTarget ?? null, d.revenueImpactPerHour ?? null,
      d.seasonalityDescription ?? null,
      d.peakPeriods ? JSON.stringify(d.peakPeriods) : null,
      d.complianceFrameworks ? JSON.stringify(d.complianceFrameworks) : null,
      d.devTeamSize ?? null, d.hasDedicatedSRE ? 1 : 0,
      d.oncallSetup ?? null,
      d.currentPainPoints ? JSON.stringify(d.currentPainPoints) : null,
      d.ddGoals ? JSON.stringify(d.ddGoals) : null,
      d.additionalContext ?? null,
      now,
    );

    const saved = db.prepare('SELECT * FROM org_context WHERE org_id = ?').get(orgId) as Record<string, unknown>;
    res.json(deserialize(saved));
  } catch (err) { next(err); }
});

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function deserialize(row: Record<string, unknown>) {
  const arr = (key: string): string[] => {
    try { return row[key] ? JSON.parse(row[key] as string) as string[] : []; } catch { return []; }
  };
  return {
    industry: str(row.industry),
    businessDescription: str(row.business_description),
    techStack: arr('tech_stack'),
    cloudProviders: arr('cloud_providers'),
    endUserScale: str(row.end_user_scale),
    transactionVolume: str(row.transaction_volume),
    deviceCount: str(row.device_count),
    tier0Description: str(row.tier0_description),
    tier1Description: str(row.tier1_description),
    tier2Description: str(row.tier2_description),
    tier0UptimeTarget: str(row.tier0_uptime_target),
    tier1UptimeTarget: str(row.tier1_uptime_target),
    revenueImpactPerHour: str(row.revenue_impact_per_hour),
    seasonalityDescription: str(row.seasonality_description),
    peakPeriods: arr('peak_periods'),
    complianceFrameworks: arr('compliance_frameworks'),
    devTeamSize: str(row.dev_team_size),
    hasDedicatedSRE: Boolean(row.has_dedicated_sre),
    oncallSetup: str(row.oncall_setup),
    currentPainPoints: arr('current_pain_points'),
    ddGoals: arr('dd_goals'),
    additionalContext: str(row.additional_context),
    updatedAt: str(row.updated_at),
  };
}

export default router;

export function getOrgContextBlock(orgId: string): string {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM org_context WHERE org_id = ?').get(orgId) as Record<string, unknown> | undefined;
  if (!row) return '';

  const ctx = deserialize(row);
  const arr = (a: string[]) => a.length ? a.join(', ') : 'not specified';
  const val = (v: string | null | undefined, fallback = 'not specified') => v || fallback;

  const lines: string[] = [
    '=== ORGANIZATION PROFILE & BUSINESS CONTEXT ===',
    `Industry: ${val(ctx.industry)}`,
    `Business: ${val(ctx.businessDescription)}`,
  ];

  if (ctx.techStack.length) lines.push(`Tech Stack: ${arr(ctx.techStack)}`);
  if (ctx.cloudProviders.length) lines.push(`Cloud Providers: ${arr(ctx.cloudProviders)}`);

  if (ctx.endUserScale || ctx.transactionVolume || ctx.deviceCount) {
    lines.push('Scale:');
    if (ctx.endUserScale) lines.push(`  End users: ${ctx.endUserScale}`);
    if (ctx.transactionVolume) lines.push(`  Transactions/day: ${ctx.transactionVolume}`);
    if (ctx.deviceCount) lines.push(`  Managed devices: ${ctx.deviceCount}`);
  }

  if (ctx.tier0Description || ctx.tier1Description || ctx.tier2Description) {
    lines.push('Service Criticality Tiers:');
    if (ctx.tier0Description) lines.push(`  Tier 0 (highest): ${ctx.tier0Description} — uptime target: ${val(ctx.tier0UptimeTarget)}`);
    if (ctx.tier1Description) lines.push(`  Tier 1: ${ctx.tier1Description} — uptime target: ${val(ctx.tier1UptimeTarget)}`);
    if (ctx.tier2Description) lines.push(`  Tier 2: ${ctx.tier2Description}`);
  }

  if (ctx.revenueImpactPerHour) lines.push(`Revenue impact per hour of Tier 0 downtime: ${ctx.revenueImpactPerHour}`);
  if (ctx.seasonalityDescription) lines.push(`Seasonality/Peak patterns: ${ctx.seasonalityDescription}`);
  if (ctx.peakPeriods.length) lines.push(`Known peak periods: ${arr(ctx.peakPeriods)}`);
  if (ctx.complianceFrameworks.length) lines.push(`Compliance: ${arr(ctx.complianceFrameworks)}`);

  lines.push(`Engineering team: ${val(ctx.devTeamSize)} engineers, SRE team: ${ctx.hasDedicatedSRE ? 'yes' : 'no'}, On-call: ${val(ctx.oncallSetup)}`);

  if (ctx.currentPainPoints.length) lines.push(`Current pain points: ${arr(ctx.currentPainPoints)}`);
  if (ctx.ddGoals.length) lines.push(`Datadog goals: ${arr(ctx.ddGoals)}`);
  if (ctx.additionalContext) lines.push(`Additional context: ${ctx.additionalContext}`);
  lines.push(`(Profile last updated: ${val(ctx.updatedAt)})`);

  return lines.join('\n');
}
