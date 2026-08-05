import clsx from 'clsx';

interface TagPillProps {
  tag: string;
  variant?: 'default' | 'env' | 'service' | 'version' | 'team' | 'missing';
  size?: 'sm' | 'md';
}

const STANDARD_KEYS_STYLE: Record<string, string> = {
  env: 'bg-green-500/15 text-green-400 border-green-500/30',
  service: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  version: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  team: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  owner: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
};

export default function TagPill({ tag, size = 'sm' }: TagPillProps) {
  const key = tag.split(':')[0].toLowerCase();
  const cls = STANDARD_KEYS_STYLE[key] ?? 'bg-surface-sunken text-ink-muted border-border';

  return (
    <span className={clsx('inline-block border rounded px-1.5 py-0.5 font-mono leading-none',
      size === 'sm' ? 'text-xs' : 'text-sm', cls)}>
      {tag}
    </span>
  );
}

export function MissingTagPill({ tagKey }: { tagKey: string }) {
  return (
    <span className="inline-block border border-dashed border-red-500/30 rounded px-1.5 py-0.5 font-mono text-xs text-red-500 leading-none">
      {tagKey}: <em>missing</em>
    </span>
  );
}
