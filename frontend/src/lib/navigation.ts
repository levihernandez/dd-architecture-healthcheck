// Single source of truth for navigation structure: sidebar groups, hub tabs,
// breadcrumbs, and the command palette all derive from this list.

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  hub: string;
  keywords?: string[];
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

  { path: '/orgs', label: 'Org Connections', icon: '⚙', hub: 'organizations' },
  { path: '/tag-templates', label: 'Industry Templates', icon: '⊞', hub: 'organizations' },
  { path: '/scans', label: 'Scan Runs', icon: '▶', hub: 'organizations' },

  { path: '/inventory', label: 'Inventory Explorer', icon: '📦', hub: 'inventory' },
  { path: '/host-gaps', label: 'Instrumentation Gaps', icon: '🕳', hub: 'inventory', keywords: ['blind spot', 'coverage', 'gaps'] },
  { path: '/cloud', label: 'Cloud Inventory', icon: '☁', hub: 'inventory' },
  { path: '/products', label: 'Product Usage', icon: '📊', hub: 'inventory' },
  { path: '/analytics', label: 'Analytics', icon: '📈', hub: 'inventory' },
  { path: '/calculators', label: 'Sizing Calculators', icon: '🔢', hub: 'inventory' },
  { path: '/usage', label: 'Plan & Usage', icon: '💳', hub: 'inventory' },

  { path: '/tagging-scorecard', label: 'Unified Tagging', icon: '✓', hub: 'health' },
  { path: '/services', label: 'Services & Catalog', icon: '⚡', hub: 'health' },
  { path: '/integrations', label: 'Integrations', icon: '🔗', hub: 'health' },
  { path: '/logs', label: 'Logs Health', icon: '📋', hub: 'health' },
  { path: '/monitors', label: 'Monitors Health', icon: '🔔', hub: 'health' },
  { path: '/dashboards', label: 'Dashboards', icon: '📉', hub: 'health' },
  { path: '/synthetics', label: 'Synthetics', icon: '🌐', hub: 'health' },
  { path: '/network', label: 'Network & Cloud', icon: '☁', hub: 'health' },
  { path: '/governance', label: 'Governance / SSO', icon: '🛡', hub: 'health' },

  { path: '/tags', label: 'Tag Explorer', icon: '🔎', hub: 'tagging' },
  { path: '/tag-mapping', label: 'Tag Normalization', icon: '⇄', hub: 'tagging' },
  { path: '/cloud-tags', label: 'Cloud Alignment', icon: '☁', hub: 'tagging' },
  { path: '/tag-governance', label: 'Multi-Org Governance', icon: '⊛', hub: 'tagging' },

  { path: '/chat', label: 'AI Chat Advisor', icon: '💬', hub: 'ai' },
  { path: '/ai', label: 'AI Assessment', icon: '✨', hub: 'ai' },
  { path: '/recommendations', label: 'Recommendations', icon: '💡', hub: 'ai' },
  { path: '/ai-settings', label: 'AI Settings', icon: '⚙', hub: 'ai' },

  { path: '/export', label: 'Export Center', icon: '⬇', hub: 'standalone' },
  { path: '/org-context', label: 'Org Profile', icon: '🧠', hub: 'standalone' },
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
