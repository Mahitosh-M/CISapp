import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types';

interface ProtectedRouteProps {
  children: JSX.Element;
  allowedRoles?: UserRole[];
}

const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { firebaseUser, role, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0B1F3A', color: '#D4AF37', fontWeight: 800 }}>
        Loading secure ERP session...
      </div>
    );
  }

  if (!firebaseUser || !role) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0B1F3A', color: '#FFFFFF', padding: 24 }}>
        <div style={{ background: '#FFFFFF', color: '#0B1F3A', borderRadius: 16, padding: 24, maxWidth: 460 }}>
          <h2 style={{ marginTop: 0 }}>Admin Access Required</h2>
          <p>This page is protected because it can change critical business rules or reports.</p>
        </div>
      </div>
    );
  }

  return children;
};

export default ProtectedRoute;
