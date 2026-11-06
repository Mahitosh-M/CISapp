import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function AdminExplanation({ children }: { children: ReactNode }) {
  const { role, userProfile } = useAuth();
  return (role ?? userProfile?.role) === 'Admin' ? <>{children}</> : null;
}
