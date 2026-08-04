import clsx from 'clsx';

interface TagPillProps {
  tag: string;
  variant?: 'default' | 'env' | 'service' | 'version' | 'team' | 'missing';
  size?: 'sm' | 'md';
}

const STANDARD_KEYS_STYLE: Record<string, string> = {
  env: 'bg-green-100 text-green-800 border-green-200',
  service: 'bg-blue-100 text-blue-800 border-blue-200',
  version: 'bg-purple-100 text-purple-800 border-purple-200',
  team: 'bg-amber-100 text-amber-800 border-amber-200',
  owner: 'bg-amber-100 text-amber-800 border-amber-200',
};

export default function TagPill({ tag, size = 'sm' }: TagPillProps) {
  const key = tag.split(':')[0].toLowerCase();
  const cls = STANDARD_KEYS_STYLE[key] ?? 'bg-gray-100 text-gray-700 border-gray-200';

  return (
    <span className={clsx('inline-block border rounded px-1.5 py-0.5 font-mono leading-none',
      size === 'sm' ? 'text-xs' : 'text-sm', cls)}>
      {tag}
    </span>
  );
}

export function MissingTagPill({ tagKey }: { tagKey: string }) {
  return (
    <span className="inline-block border border-dashed border-red-300 rounded px-1.5 py-0.5 font-mono text-xs text-red-500 leading-none">
      {tagKey}: <em>missing</em>
    </span>
  );
}
