import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Login = () => {
  const { firebaseUser, role, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (firebaseUser && role) {
    return <Navigate to={role === 'customer' || role === 'Medical' ? '/customer' : '/'} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    try {
      setSaving(true);
      setError('');
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to login.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.24)',
    background: '#FFFFFF',
    color: '#020617',
    WebkitTextFillColor: '#020617',
    caretColor: '#020617',
    fontWeight: 800,
    marginTop: 6
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--app-page-background)', padding: 20 }}>
      <form onSubmit={handleSubmit} style={{ background: 'linear-gradient(135deg, #4A155F 0%, #2A1049 45%, #091D42 100%)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 18, padding: 28, width: '100%', maxWidth: 420, color: '#FFFFFF', boxShadow: '0 24px 54px rgba(0,0,0,0.42)' }}>
        <label style={{ display: 'block', fontWeight: 800, marginBottom: 14 }}>
          Email
          <input className="login-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} style={inputStyle} />
        </label>

        <label style={{ display: 'block', fontWeight: 800, marginBottom: 14 }}>
          Password
          <input className="login-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} style={inputStyle} />
        </label>

        {error ? <div style={{ color: '#B42318', marginBottom: 12 }}>{error}</div> : null}

        <button type="submit" disabled={saving} style={{ width: '100%', border: 0, borderRadius: 10, padding: 12, background: '#D4AF37', color: '#0B1F3A', fontWeight: 900, cursor: 'pointer' }}>
          {saving ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
};

export default Login;
