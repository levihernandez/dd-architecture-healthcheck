import clsx from 'clsx';

interface FilterChipProps {
  label: string;
  active?: boolean;
  count?: number;
  onClick?: () => void;
  onRemove?: () => void;
}

function FilterChip({ label, active, count, onClick, onRemove }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-dd-purple/10 border-dd-purple/30 text-dd-purple'
          : 'bg-white border-border-strong text-ink-muted hover:bg-surface-subtle'
      )}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span className={clsx('rounded-full px-1.5 text-[10px]', active ? 'bg-dd-purple/15' : 'bg-surface-sunken')}>
          {count}
        </span>
      )}
      {onRemove && (
        <span
          role="button"
          aria-label={`Remove ${label} filter`}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 text-ink-faint hover:text-ink"
        >
          ✕
        </span>
      )}
    </button>
  );
}

export function FilterChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export default FilterChip;
export { FilterChip };
