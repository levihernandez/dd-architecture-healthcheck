import { Router } from 'express';
import { z } from 'zod';
import { getDatabase } from '../../db/database';
import { AppError } from '../middleware/error.middleware';
import { assertOrgAccess } from '../../auth/org-access';
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
router.get('/:orgId/context', async (req, res, next) => {
  try {
    const { orgId } = req.params;
    await assertOrgAccess(orgId, req.user!.id);
    const db = getDatabase();
    const row = await db<Record<string, unknown>>('org_context').where({ org_id: orgId }).first();
    if (!row) { res.json(null); return; }
    res.json(deserialize(row));
  } catch (err) { next(err); }
});

// PUT /api/orgs/:orgId/context
router.put('/:orgId/context', async (req, res, next) => {
  try {
    const { orgId } = req.params;
    await assertOrgAccess(orgId, req.user!.id);
    const parse = OrgContextSchema.safeParse(req.body);
    if (!parse.success) throw new AppError('Invalid context data', 400);

    const db = getDatabase();
    const org = await db('orgs').select('id').where({ id: orgId }).first();
    if (!org) throw new AppError('Org not found', 404);

    const d = parse.data;
    const now = new Date().toISOString();

    await db('org_context')
      .insert({
        id: uuidv4(),
        org_id: orgId,
        industry: d.industry ?? null,
        business_description: d.businessDescription ?? null,
        tech_stack: d.techStack ? JSON.stringify(d.techStack) : null,
        cloud_providers: d.cloudProviders ? JSON.stringify(d.cloudProviders) : null,
        end_user_scale: d.endUserScale ?? null,
        transaction_volume: d.transactionVolume ?? null,
        device_count: d.deviceCount ?? null,
        tier0_description: d.tier0Description ?? null,
        tier1_description: d.tier1Description ?? null,
        tier2_description: d.tier2Description ?? null,
        tier0_uptime_target: d.tier0UptimeTarget ?? null,
        tier1_uptime_target: d.tier1UptimeTarget ?? null,
        revenue_impact_per_hour: d.revenueImpactPerHour ?? null,
        seasonality_description: d.seasonalityDescription ?? null,
        peak_periods: d.peakPeriods ? JSON.stringify(d.peakPeriods) : null,
        compliance_frameworks: d.complianceFrameworks ? JSON.stringify(d.complianceFrameworks) : null,
        dev_team_size: d.devTeamSize ?? null,
        has_dedicated_sre: d.hasDedicatedSRE ? 1 : 0,
        oncall_setup: d.oncallSetup ?? null,
        current_pain_points: d.currentPainPoints ? JSON.stringify(d.currentPainPoints) : null,
        dd_goals: d.ddGoals ? JSON.stringify(d.ddGoals) : null,
        additional_context: d.additionalContext ?? null,
        updated_at: now,
      })
      .onConflict('org_id')
      .merge();

    const saved = await db<Record<string, unknown>>('org_context').where({ org_id: orgId }).first();
    res.json(deserialize(saved!));
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

export async function getOrgContextBlock(orgId: string): Promise<string> {
  const db = getDatabase();
  const row = await db<Record<string, unknown>>('org_context').where({ org_id: orgId }).first();
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
