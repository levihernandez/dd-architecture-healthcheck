import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '../services/api';
import { useAuthContext } from '../context/AuthContext';

export default function Register() {
  const navigate = useNavigate();
  const { login } = useAuthContext();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { token, user } = await authApi.register(email, password, name || undefined);
      login(token, user);
      navigate('/overview', { replace: true });
    } catch (err) {
      setError((err as any)?.response?.data?.message ?? 'Failed to create account');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-semibold text-ink">Create an account</h1>
          <p className="text-sm text-ink-muted">Datadog Architecture Health Check</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-md px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="label">Name (optional)</label>
            <input
              type="text" className="input" placeholder="Jane Doe"
              value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Email</label>
            <input
              type="email" className="input" placeholder="you@company.com"
              value={email} required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Password</label>
            <input
              type="password" className="input"
              value={password} required minLength={8}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-ink-faint mt-1">At least 8 characters.</p>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-ink-muted">
          Already have an account? <Link to="/login" className="text-ink hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
