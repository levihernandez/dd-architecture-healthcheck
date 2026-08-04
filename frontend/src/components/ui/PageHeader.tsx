interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

/**
 * Standard page header: title, subtitle, and a right-aligned actions slot.
 * The breadcrumb trail lives in the top app bar (Header), not here, to avoid
 * showing it twice. Used at the top of every page in place of ad-hoc header markup.
 */
export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-display text-ink">{title}</h1>
          {subtitle && <p className="text-ink-muted text-sm mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
