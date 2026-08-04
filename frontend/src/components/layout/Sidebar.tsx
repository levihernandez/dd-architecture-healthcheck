import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  section?: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/overview', label: 'Overview', icon: '⬡', section: 'main' },
  { path: '/orgs', label: 'Org Connections', icon: '⚙', section: 'main' },
  { path: '/scans', label: 'Scan Runs', icon: '▶', section: 'main' },
  { path: '/inventory', label: 'Inventory Explorer', icon: '📦', section: 'inventory' },
  { path: '/products', label: 'Product Usage', icon: '📊', section: 'inventory' },
  { path: '/tags', label: 'Tag Explorer', icon: '🏷', section: 'inventory' },
  { path: '/tagging-scorecard', label: 'Unified Tagging', icon: '✓', section: 'health' },
  { path: '/services', label: 'Services & Catalog', icon: '⚡', section: 'health' },
  { path: '/integrations', label: 'Integrations', icon: '🔗', section: 'health' },
  { path: '/logs', label: 'Logs Health', icon: '📋', section: 'health' },
  { path: '/monitors', label: 'Monitors Health', icon: '🔔', section: 'health' },
  { path: '/dashboards', label: 'Dashboards', icon: '📈', section: 'health' },
  { path: '/synthetics', label: 'Synthetics', icon: '🌐', section: 'health' },
  { path: '/network', label: 'Network & Cloud', icon: '☁', section: 'health' },
  { path: '/governance', label: 'Governance / SSO', icon: '🛡', section: 'health' },
  { path: '/tag-mapping', label: 'Tag Normalization', icon: '⇄', section: 'tagging' },
  { path: '/cloud-tags', label: 'Cloud Alignment', icon: '☁', section: 'tagging' },
  { path: '/tag-templates', label: 'Industry Templates', icon: '⊞', section: 'tagging' },
  { path: '/tag-governance', label: 'Multi-Org Governance', icon: '⊛', section: 'tagging' },
  { path: '/analytics', label: 'Analytics', icon: '📊', section: 'inventory' },
  { path: '/cloud', label: 'Cloud Inventory', icon: '☁', section: 'inventory' },
  { path: '/calculators', label: 'Sizing Calculators', icon: '🔢', section: 'inventory' },
  { path: '/usage', label: 'Plan & Usage', icon: '💳', section: 'inventory' },
  { path: '/org-context', label: 'Org Profile', icon: '🧠', section: 'main' },
  { path: '/chat', label: 'AI Chat Advisor', icon: '💬', section: 'analysis' },
  { path: '/ai', label: 'AI Assessment', icon: '✨', section: 'analysis' },
  { path: '/ai-settings', label: 'AI Settings', icon: '⚙', section: 'analysis' },
  { path: '/recommendations', label: 'Recommendations', icon: '💡', section: 'analysis' },
  { path: '/export', label: 'Export Center', icon: '⬇', section: 'analysis' },
];

const SECTIONS: Record<string, string> = {
  main: 'Navigation',
  inventory: 'Inventory',
  health: 'Health Checks',
  tagging: 'Tagging Intelligence',
  analysis: 'Analysis & Export',
};

export default function Sidebar() {
  const sections = [...new Set(NAV_ITEMS.map((i) => i.section ?? 'main'))];

  return (
    <aside className="w-64 bg-gray-900 text-gray-100 flex flex-col h-screen sticky top-0 overflow-y-auto">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-dd-purple rounded-md flex items-center justify-center text-white font-bold text-sm">
            DD
          </div>
          <div>
            <div className="font-semibold text-sm leading-none">Architecture</div>
            <div className="text-gray-400 text-xs mt-0.5">Health Check</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2">
        {sections.map((section) => {
          const items = NAV_ITEMS.filter((i) => (i.section ?? 'main') === section);
          return (
            <div key={section} className="mb-4">
              <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                {SECTIONS[section]}
              </div>
              {items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                      isActive
                        ? 'bg-dd-purple text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    )
                  }
                >
                  <span className="text-base w-5 text-center">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500">
        <div>Read-only Datadog API</div>
        <div>Local SQLite storage</div>
      </div>
    </aside>
  );
}
