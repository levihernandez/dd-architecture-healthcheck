import type { FindingCategory } from '../types/assessment.types';

const ALL_CATEGORIES: FindingCategory[] = [
  'unified_tagging', 'service_architecture', 'integration_hygiene', 'logs_health',
  'monitors_health', 'dashboards_health', 'synthetics_health', 'network_cloud',
  'governance', 'security_posture', 'cost_optimization',
];

export interface PageContext {
  category: FindingCategory;
  label: string;
}

// Route path -> the category that page is about, mirroring frontend/src/lib/navigation.ts.
// Pages with no clear single-category focus (Overview, Analytics, Inventory, etc.) are
// deliberately absent — general chat there keeps today's full-org-context behavior.
export const PAGE_CATEGORY_MAP: Record<string, PageContext> = {
  '/tagging-scorecard': { category: 'unified_tagging', label: 'Unified Tagging Scorecard' },
  '/tags': { category: 'unified_tagging', label: 'Tag Explorer' },
  '/tag-mapping': { category: 'unified_tagging', label: 'Tag Normalization' },
  '/cloud-tags': { category: 'unified_tagging', label: 'Cloud Tag Alignment' },
  '/tag-templates': { category: 'unified_tagging', label: 'Industry Tag Templates' },
  '/tag-governance': { category: 'unified_tagging', label: 'Tag Governance' },
  '/services': { category: 'service_architecture', label: 'Services & Catalog' },
  '/monitors': { category: 'monitors_health', label: 'Monitors Health' },
  '/logs': { category: 'logs_health', label: 'Logs Health' },
  '/dashboards': { category: 'dashboards_health', label: 'Dashboards' },
  '/synthetics': { category: 'synthetics_health', label: 'Synthetics' },
  '/integrations': { category: 'integration_hygiene', label: 'Integrations' },
  '/network': { category: 'network_cloud', label: 'Network & Cloud' },
  '/governance': { category: 'governance', label: 'Governance' },
  '/usage': { category: 'cost_optimization', label: 'Plan & Usage' },
};

// Accepts either a known route path or a literal FindingCategory string (used by
// AISectionInsight, which already knows its section's category with no route to resolve).
export function resolvePageContext(page?: string): PageContext | undefined {
  if (!page) return undefined;
  if (PAGE_CATEGORY_MAP[page]) return PAGE_CATEGORY_MAP[page];
  if (ALL_CATEGORIES.includes(page as FindingCategory)) {
    return { category: page as FindingCategory, label: page.replace(/_/g, ' ') };
  }
  return undefined;
}
