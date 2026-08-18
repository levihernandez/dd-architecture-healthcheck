// Single source of truth for navigation structure: sidebar groups, hub tabs,
// breadcrumbs, and the command palette all derive from this list.

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  hub: string;
  keywords?: string[];
  // Key into the feature-flags tree (backend/src/feature-flags/registry.ts).
  // When set, the sidebar hides the item and the route is wrapped in
  // <FeatureGate> if its effective state is disabled. Omit for always-on pages.
  featureKey?: string;
}

export interface HubDef {
  id: string;
  label: string;
  icon: string;
}

export const HUBS: HubDef[] = [
  { id: 'home', label: 'Home', icon: '⬡' },
  { id: 'organizations', label: 'Organizations', icon: '⚙' },
  { id: 'inventory', label: 'Inventory', icon: '📦' },
  { id: 'health', label: 'Health Checks', icon: '✓' },
  { id: 'tagging', label: 'Tagging Intelligence', icon: '🏷' },
  { id: 'ai', label: 'AI & Analysis', icon: '✨' },
  { id: 'standalone', label: 'More', icon: '⊙' },
];

export const NAV_ITEMS: NavItem[] = [
  { path: '/overview', label: 'Overview', icon: '⬡', hub: 'home' },

  { path: '/orgs', label: 'Org Connections', icon: '⚙', hub: 'organizations', featureKey: 'page.orgs' },
  { path: '/tag-templates', label: 'Industry Templates', icon: '⊞', hub: 'organizations' },
  { path: '/scans', label: 'Scan Runs', icon: '▶', hub: 'organizations' },
  { path: '/scan-comparison', label: 'Scan Comparison', icon: '⇄', hub: 'organizations', keywords: ['diff', 'compare', 'trend', 'regression'], featureKey: 'page.scan_comparison' },

  { path: '/inventory', label: 'Inventory Explorer', icon: '📦', hub: 'inventory' },
  { path: '/host-gaps', label: 'Instrumentation Gaps', icon: '🕳', hub: 'inventory', keywords: ['blind spot', 'coverage', 'gaps'], featureKey: 'page.host_gaps' },
  { path: '/cloud', label: 'Cloud Inventory', icon: '☁', hub: 'inventory', featureKey: 'page.cloud' },
  { path: '/products', label: 'Product Usage', icon: '📊', hub: 'inventory', featureKey: 'page.products' },
  { path: '/analytics', label: 'Analytics', icon: '📈', hub: 'inventory' },
  { path: '/calculators', label: 'Sizing Calculators', icon: '🔢', hub: 'inventory', featureKey: 'page.calculators' },
  { path: '/usage', label: 'Plan & Usage', icon: '💳', hub: 'inventory', featureKey: 'page.usage' },

  { path: '/tagging-scorecard', label: 'Unified Tagging', icon: '✓', hub: 'health', featureKey: 'page.tagging_scorecard' },
  { path: '/services', label: 'Services & Catalog', icon: '⚡', hub: 'health', featureKey: 'page.services' },
  { path: '/integrations', label: 'Integrations', icon: '🔗', hub: 'health', featureKey: 'page.integrations' },
  { path: '/logs', label: 'Logs Health', icon: '📋', hub: 'health', featureKey: 'page.logs' },
  { path: '/monitors', label: 'Monitors Health', icon: '🔔', hub: 'health', featureKey: 'page.monitors' },
  { path: '/dashboards', label: 'Dashboards', icon: '📉', hub: 'health', featureKey: 'page.dashboards' },
  { path: '/synthetics', label: 'Synthetics', icon: '🌐', hub: 'health', featureKey: 'page.synthetics' },
  { path: '/network', label: 'Network & Cloud', icon: '☁', hub: 'health', featureKey: 'page.network' },
  { path: '/governance', label: 'Governance / SSO', icon: '🛡', hub: 'health', featureKey: 'page.governance' },
  { path: '/events', label: 'Event Stats', icon: '⚡', hub: 'health', featureKey: 'page.events' },

  { path: '/tags', label: 'Tag Explorer', icon: '🔎', hub: 'tagging', featureKey: 'page.tags' },
  { path: '/tag-mapping', label: 'Tag Normalization', icon: '⇄', hub: 'tagging', featureKey: 'page.tag_mapping' },
  { path: '/cloud-tags', label: 'Cloud Alignment', icon: '☁', hub: 'tagging', featureKey: 'page.cloud_tags' },
  { path: '/tag-governance', label: 'Multi-Org Governance', icon: '⊛', hub: 'tagging', featureKey: 'page.tag_governance' },
  { path: '/tagging-implementation', label: 'Implementation Guide', icon: '🛠', hub: 'tagging', keywords: ['bits ai', 'terraform', 'ansible', 'scom', 'fleet automation', 'hard tagging', 'soft tagging'], featureKey: 'page.tagging_implementation' },

  { path: '/chat', label: 'AI Chat Advisor', icon: '💬', hub: 'ai', featureKey: 'page.chat' },
  { path: '/ai', label: 'AI Assessment', icon: '✨', hub: 'ai' },
  { path: '/recommendations', label: 'Recommendations', icon: '💡', hub: 'ai', featureKey: 'page.recommendations' },
  { path: '/ai-settings', label: 'AI Settings', icon: '⚙', hub: 'ai' },

  { path: '/export', label: 'Export Center', icon: '⬇', hub: 'standalone', featureKey: 'page.export' },
  { path: '/org-context', label: 'Org Profile', icon: '🧠', hub: 'standalone' },
  { path: '/feature-flags', label: 'Feature Flags', icon: '🚩', hub: 'standalone' },
];

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => pathname === i.path || pathname.startsWith(i.path + '/'));
}

export function hubItems(hubId: string): NavItem[] {
  return NAV_ITEMS.filter((i) => i.hub === hubId);
}

export function hubFor(pathname: string): HubDef | undefined {
  const item = findNavItem(pathname);
  if (!item) return undefined;
  return HUBS.find((h) => h.id === item.hub);
}
