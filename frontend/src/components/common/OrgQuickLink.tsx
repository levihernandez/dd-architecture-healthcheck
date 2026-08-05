import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useOrgScanContext } from '../../context/OrgScanContext';

interface OrgQuickLinkProps {
  orgId: string;
  orgName: string;
  className?: string;
  /** 'link' (default) applies the standard link color; 'inherit' leaves color entirely to `className` — for use inside an already-colored badge/chip. */
  variant?: 'link' | 'inherit';
}

/**
 * Jumps to this org's Analytics view — sets it as the globally selected org
 * (clearing any selected scan so the org's latest scan is picked up) and
 * navigates there. Used anywhere a data segment references an org by name,
 * so the reader is never stuck reading a name with no way back to it.
 */
export default function OrgQuickLink({ orgId, orgName, className, variant = 'link' }: OrgQuickLinkProps) {
  const navigate = useNavigate();
  const { setSelectedOrgId } = useOrgScanContext();

  if (!orgId) return <span className={className}>{orgName}</span>;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setSelectedOrgId(orgId);
        navigate('/analytics');
      }}
      title={`Jump to ${orgName}`}
      className={clsx(
        'text-left hover:underline underline-offset-2 transition-colors',
        variant === 'link' && 'text-dd-purple hover:text-dd-purple-dark font-medium',
        className
      )}
    >
      {orgName}
    </button>
  );
}
