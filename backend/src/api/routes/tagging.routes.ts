import { Router } from 'express';
import { AppError } from '../middleware/error.middleware';
import { assertOrgAccess } from '../../auth/org-access';
import { analyzeTagNormalization } from '../../tagging/normalization';
import { analyzeCloudAlignment } from '../../tagging/cloud-alignment';
import { analyzeTagPropagation } from '../../tagging/propagation';
import {
  INDUSTRY_TEMPLATES, ORG_TEMPLATES, scoreAgainstTemplate, detectRecommendedTemplate,
  TAG_POLICY_GUIDANCE, TAG_ENFORCEMENT_MATRIX, TAG_POLICY_RESOURCES,
} from '../../tagging/templates';
import { analyzeMultiOrgGovernance } from '../../tagging/governance';
import { analyzeCostReadiness } from '../../tagging/cost-readiness';
import { TAG_DICTIONARY, lookupTag } from '../../tagging/tag-dictionary';
import { buildMaturityAssessmentPrompt, buildRemediationExecutionPrompt } from '../../tagging/maturity-assessment';

const router = Router();

function req2ids(req: { query: Record<string, unknown> }) {
  return {
    orgId: req.query.orgId as string | undefined,
    scanRunId: req.query.scanRunId as string | undefined,
  };
}

// GET /api/tagging/dictionary
// Full tag dictionary with what/why/how/when/where
router.get('/dictionary', (_req, res) => {
  res.json(TAG_DICTIONARY);
});

// GET /api/tagging/dictionary/:key
router.get('/dictionary/:key', (req, res, next) => {
  try {
    const def = lookupTag(req.params.key);
    if (!def) throw new AppError(`Tag "${req.params.key}" not found in dictionary`, 404);
    res.json(def);
  } catch (err) { next(err); }
});

// GET /api/tagging/normalization?orgId=&scanRunId=
router.get('/normalization', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req2ids(req as Parameters<typeof req2ids>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);
    res.json(await analyzeTagNormalization(orgId, scanRunId));
  } catch (err) { next(err); }
});

// GET /api/tagging/cloud-alignment?orgId=&scanRunId=
router.get('/cloud-alignment', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req2ids(req as Parameters<typeof req2ids>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);
    res.json(await analyzeCloudAlignment(orgId, scanRunId));
  } catch (err) { next(err); }
});

// GET /api/tagging/propagation?orgId=&scanRunId=
router.get('/propagation', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req2ids(req as Parameters<typeof req2ids>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);
    res.json(await analyzeTagPropagation(orgId, scanRunId));
  } catch (err) { next(err); }
});

// GET /api/tagging/templates
router.get('/templates', (_req, res) => {
  const all = [...INDUSTRY_TEMPLATES, ...ORG_TEMPLATES].map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    sector: t.sector,
    description: t.description,
    icon: t.icon,
    requiredCount: t.globalBaseline.length + t.required.length,
    recommendedCount: t.recommended.length,
    optionalCount: t.optional.length,
    hasComplianceTags: (t.complianceTags?.length ?? 0) > 0,
  }));
  res.json(all);
});

// GET /api/tagging/templates/:id
router.get('/templates/:id', (req, res, next) => {
  try {
    const all = [...INDUSTRY_TEMPLATES, ...ORG_TEMPLATES];
    const tmpl = all.find((t) => t.id === req.params.id);
    if (!tmpl) throw new AppError(`Template "${req.params.id}" not found`, 404);
    res.json(tmpl);
  } catch (err) { next(err); }
});

// GET /api/tagging/score?orgId=&scanRunId=&templateId=
router.get('/score', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req2ids(req as Parameters<typeof req2ids>[0]);
    const templateId = req.query.templateId as string | undefined;
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    if (!templateId) throw new AppError('templateId required', 400);
    await assertOrgAccess(orgId, req.user!.id);
    res.json(await scoreAgainstTemplate(orgId, scanRunId, templateId));
  } catch (err) { next(err); }
});

// GET /api/tagging/detect-template?orgId=&scanRunId=
router.get('/detect-template', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req2ids(req as Parameters<typeof req2ids>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);
    const recommended = await detectRecommendedTemplate(orgId, scanRunId);
    res.json({ recommended });
  } catch (err) { next(err); }
});

// GET /api/tagging/policy-guidance — where/how to enforce tag policy, independent of any one template
router.get('/policy-guidance', (_req, res) => {
  res.json(TAG_POLICY_GUIDANCE);
});

// GET /api/tagging/tag-enforcement — which resource types support tags vs. can be made mandatory
router.get('/tag-enforcement', (_req, res) => {
  res.json(TAG_ENFORCEMENT_MATRIX);
});

// GET /api/tagging/policy-resources — public docs/product links for setting up tag policies
router.get('/policy-resources', (_req, res) => {
  res.json(TAG_POLICY_RESOURCES);
});

// GET /api/tagging/maturity-assessment?orgId=&scanRunId= — scanRunId optional; generates a
// Bits AI-ready UST maturity assessment prompt, industry and suggested tags auto-filled
// from this org's selected/detected industry template.
router.get('/maturity-assessment', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req2ids(req as Parameters<typeof req2ids>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    await assertOrgAccess(orgId, req.user!.id);
    res.json(await buildMaturityAssessmentPrompt({ orgId, scanRunId }));
  } catch (err) { next(err); }
});

// GET /api/tagging/remediation-execution?orgId=&scanRunId= — scanRunId optional; generates a
// Bits AI-ready prompt that instructs the agent to actually apply the tag fixes via the
// Datadog UI (not just report on them), industry and suggested tags auto-filled as above.
router.get('/remediation-execution', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req2ids(req as Parameters<typeof req2ids>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    await assertOrgAccess(orgId, req.user!.id);
    res.json(await buildRemediationExecutionPrompt({ orgId, scanRunId }));
  } catch (err) { next(err); }
});

// GET /api/tagging/governance
router.get('/governance', async (req, res, next) => {
  try {
    res.json(await analyzeMultiOrgGovernance(req.user!.id));
  } catch (err) { next(err); }
});

// GET /api/tagging/cost-readiness?orgId=&scanRunId=
router.get('/cost-readiness', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = req2ids(req as Parameters<typeof req2ids>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);
    res.json(await analyzeCostReadiness(orgId, scanRunId));
  } catch (err) { next(err); }
});

export default router;
