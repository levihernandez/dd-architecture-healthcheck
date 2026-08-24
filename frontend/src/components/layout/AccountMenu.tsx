import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { authApi } from '../../services/api';
import { useAuthContext } from '../../context/AuthContext';
import { PopoverRoot, PopoverTrigger, PopoverContent } from '../ui/Popover';

export default function AccountMenu({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuthContext();
  const [open, setOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const userInitial = (user?.name || user?.email || '?').charAt(0).toUpperCase();

  const closeAndReset = () => {
    setOpen(false);
    setShowChangePassword(false);
  };

  return (
    <PopoverRoot open={open} onOpenChange={(next) => { setOpen(next); if (!next) setShowChangePassword(false); }}>
      <PopoverTrigger
        className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-sunken border border-border-strong text-sm font-medium text-ink hover:border-ink-faint transition-colors shrink-0"
        aria-label="Account menu"
      >
        {userInitial}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        {showChangePassword ? (
          <ChangePasswordForm onDone={closeAndReset} onBack={() => setShowChangePassword(false)} />
        ) : (
          <>
            <div className="mb-3">
              <div className="text-sm font-medium text-ink truncate">{user?.name || 'Account'}</div>
              <div className="text-xs text-ink-faint truncate">{user?.email}</div>
            </div>
            <div className="space-y-2">
              <button onClick={() => setShowChangePassword(true)} className="btn-secondary w-full text-sm">
                Change password
              </button>
              <button onClick={onLogout} className="btn-secondary w-full text-sm">
                Log out
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}

function ChangePasswordForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast.success('Password updated');
      onDone();
    } catch (err) {
      setError((err as any)?.response?.data?.message ?? 'Failed to change password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Change password</h3>
        <button type="button" onClick={onBack} className="text-xs text-ink-faint hover:text-ink-muted">
          Back
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <div>
        <label className="label">Current password</label>
        <input
          type="password" className="input text-sm"
          value={currentPassword} required autoFocus
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>

      <div>
        <label className="label">New password</label>
        <input
          type="password" className="input text-sm"
          value={newPassword} required minLength={8}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>

      <div>
        <label className="label">Confirm new password</label>
        <input
          type="password" className="input text-sm"
          value={confirmPassword} required minLength={8}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>

      <button type="submit" className="btn-primary w-full text-sm" disabled={isSubmitting}>
        {isSubmitting ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}
