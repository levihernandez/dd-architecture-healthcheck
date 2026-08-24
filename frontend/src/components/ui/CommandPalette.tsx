import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HUBS, NAV_ITEMS } from '../../lib/navigation';
import { useOrgs, useScans } from '../../hooks/useOrgs';
import { useOrgScanContext } from '../../context/OrgScanContext';
import { usePinnedPages, useRecentPages } from '../../hooks/usePinnedPages';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { useViewFeatureFlagsUi } from '../../hooks/useViewFeatureFlagsUi';
import { scansApi } from '../../services/api';

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: orgs = [] } = useOrgs();
  const { selectedOrgId, setSelectedOrgId, setSelectedScanId } = useOrgScanContext();
  const { data: scans = [] } = useScans(selectedOrgId || undefined);
  const { pinned, togglePin } = usePinnedPages();
  const { recent } = useRecentPages();
  const { isPageEnabled } = useFeatureFlags();
  const viewFfEnabled = useViewFeatureFlagsUi();
  const isNavItemVisible = (item?: { featureKey?: string; debugOnly?: boolean }) =>
    Boolean(item) && isPageEnabled(item?.featureKey) && (!item?.debugOnly || viewFfEnabled);

  const startScan = useMutation({
    mutationFn: (orgId: string) => scansApi.start(orgId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['orgs'] });
      toast.success('Scan started');
    },
    onError: () => toast.error('Failed to start scan'),
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function go(path: string) {
    navigate(path);
    setOpen(false);
  }

  // Direct pivots to content that lives inside a modal/section rather than its
  // own route, so it's still reachable by typing a name like "Bits AI".
  const quickActions = [
    {
      key: 'bits-ai-maturity',
      icon: '🤖',
      label: 'Bits AI: Tagging Maturity Assessment prompt',
      value: 'bits ai bitsai bits maturity assessment tagging prompt',
      path: '/tag-templates?guide=maturity',
    },
    {
      key: 'bits-ai-remediation',
      icon: '🤖',
      label: 'Bits AI: Tagging Remediation Execution prompt',
      value: 'bits ai bitsai bits remediation execution tagging prompt fix',
      path: '/tag-templates?guide=remediation',
    },
  ];

  const recentItems = recent
    .map((path) => NAV_ITEMS.find((i) => i.path === path))
    .filter((i): i is (typeof NAV_ITEMS)[number] => isNavItemVisible(i));
  const pinnedItems = pinned
    .map((path) => NAV_ITEMS.find((i) => i.path === path))
    .filter((i): i is (typeof NAV_ITEMS)[number] => isNavItemVisible(i));

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="fixed inset-0 z-[100]"
      shouldFilter
    >
      <div className="fixed inset-0 bg-black/60 animate-fade-in" onClick={() => setOpen(false)} />
      <div className="fixed top-[12%] left-1/2 -translate-x-1/2 w-full max-w-lg animate-scale-in">
        <div className="bg-surface-subtle rounded-lg shadow-lg border border-border overflow-hidden">
          <Command.Input
            autoFocus
            placeholder="Search pages, switch org, run scan…"
            className="w-full px-4 py-3.5 text-sm bg-surface-subtle text-ink border-b border-border outline-none placeholder-ink-faint"
          />
          <Command.List className="max-h-96 overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-ink-faint">No results found.</Command.Empty>

            {pinnedItems.length > 0 && (
              <Command.Group heading="Pinned" className="text-caption text-ink-faint uppercase px-2 py-1.5">
                {pinnedItems.map((item) => (
                  <Command.Item
                    key={item.path}
                    value={`pinned ${item.label}`}
                    onSelect={() => go(item.path)}
                    className="flex items-center gap-2.5 px-2 py-2 rounded text-sm text-ink cursor-pointer data-[selected=true]:bg-surface-subtle"
                  >
                    <span className="w-4 text-center">{item.icon}</span>
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {recentItems.length > 0 && (
              <Command.Group heading="Recently viewed" className="text-caption text-ink-faint uppercase px-2 py-1.5">
                {recentItems.map((item) => (
                  <Command.Item
                    key={item.path}
                    value={`recent ${item.label}`}
                    onSelect={() => go(item.path)}
                    className="flex items-center gap-2.5 px-2 py-2 rounded text-sm text-ink cursor-pointer data-[selected=true]:bg-surface-subtle"
                  >
                    <span className="w-4 text-center">{item.icon}</span>
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Quick actions" className="text-caption text-ink-faint uppercase px-2 py-1.5">
              {quickActions.map((action) => (
                <Command.Item
                  key={action.key}
                  value={action.value}
                  onSelect={() => go(action.path)}
                  className="flex items-center gap-2.5 px-2 py-2 rounded text-sm text-ink cursor-pointer data-[selected=true]:bg-surface-subtle"
                >
                  <span className="w-4 text-center">{action.icon}</span>
                  {action.label}
                </Command.Item>
              ))}
            </Command.Group>

            {orgs.length > 0 && (
              <Command.Group heading="Switch organization" className="text-caption text-ink-faint uppercase px-2 py-1.5">
                {orgs.map((org) => (
                  <Command.Item
                    key={org.id}
                    value={`org ${org.name}`}
                    onSelect={() => { setSelectedOrgId(org.id); setOpen(false); }}
                    className="flex items-center gap-2.5 px-2 py-2 rounded text-sm text-ink cursor-pointer data-[selected=true]:bg-surface-subtle"
                  >
                    <span className="w-4 text-center">⚙</span>
                    {org.name}
                    {org.id === selectedOrgId && <span className="ml-auto text-xs text-dd-purple">current</span>}
                  </Command.Item>
                ))}
                {selectedOrgId && (
                  <Command.Item
                    value="run scan action"
                    onSelect={() => { startScan.mutate(selectedOrgId); setOpen(false); }}
                    className="flex items-center gap-2.5 px-2 py-2 rounded text-sm text-ink cursor-pointer data-[selected=true]:bg-surface-subtle"
                  >
                    <span className="w-4 text-center">▶</span>
                    Run scan for current org
                  </Command.Item>
                )}
              </Command.Group>
            )}

            {scans.filter((s) => s.status === 'completed').length > 0 && (
              <Command.Group heading="Switch scan" className="text-caption text-ink-faint uppercase px-2 py-1.5">
                {scans.filter((s) => s.status === 'completed').slice(0, 5).map((scan) => (
                  <Command.Item
                    key={scan.id}
                    value={`scan ${scan.startedAt}`}
                    onSelect={() => { setSelectedScanId(scan.id); setOpen(false); }}
                    className="flex items-center gap-2.5 px-2 py-2 rounded text-sm text-ink cursor-pointer data-[selected=true]:bg-surface-subtle"
                  >
                    <span className="w-4 text-center">▶</span>
                    {new Date(scan.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {HUBS.map((hub) => {
              const items = NAV_ITEMS.filter((i) => i.hub === hub.id && isNavItemVisible(i));
              if (items.length === 0) return null;
              return (
                <Command.Group key={hub.id} heading={hub.label} className="text-caption text-ink-faint uppercase px-2 py-1.5">
                  {items.map((item) => (
                    <Command.Item
                      key={item.path}
                      value={`${hub.label} ${item.label} ${(item.keywords ?? []).join(' ')}`}
                      onSelect={() => go(item.path)}
                      className="flex items-center gap-2.5 px-2 py-2 rounded text-sm text-ink cursor-pointer data-[selected=true]:bg-surface-subtle"
                    >
                      <span className="w-4 text-center">{item.icon}</span>
                      {item.label}
                      <button
                        aria-label={pinned.includes(item.path) ? 'Unpin' : 'Pin'}
                        onClick={(e) => { e.stopPropagation(); togglePin(item.path); }}
                        className="ml-auto text-xs text-ink-faint hover:text-dd-purple"
                      >
                        {pinned.includes(item.path) ? '★' : '☆'}
                      </button>
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
          <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-[11px] text-ink-faint bg-surface-subtle">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </div>
        </div>
      </div>
    </Command.Dialog>
  );
}
