import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { loadStaffOpenOrders, type StaffOrderSummary } from '../services/orderAppService';
interface StaffOrdersState { orders: StaffOrderSummary[]; loading: boolean; error: string; checked: boolean; refresh: () => Promise<void> }
const Context = createContext<StaffOrdersState | null>(null);
export function StaffOrdersProvider({ children }: { children: ReactNode }) {
  const { userProfile } = useAuth();
  const staff = userProfile?.role === 'Staff';
  const [orders, setOrders] = useState<StaffOrderSummary[]>([]), [loading, setLoading] = useState(staff);
  const [error, setError] = useState(''), [checked, setChecked] = useState(false);
  const refresh = useCallback(async () => {
    if (!staff) return;
    setLoading(true); setError('');
    try { setOrders(await loadStaffOpenOrders()); setChecked(true); }
    catch { setError('Unable to load orders. Please retry.'); }
    finally { setLoading(false); }
  }, [staff]);
  const initialLoad = useRef(false);
  useEffect(() => { if (!staff) { initialLoad.current = false; return; } if (!initialLoad.current) { initialLoad.current = true; void refresh(); } }, [refresh, staff]);
  return <Context.Provider value={{ orders, loading, error, checked, refresh }}>{children}</Context.Provider>;
}
export function useStaffOrders() { const value = useContext(Context); if (!value) throw new Error('Orders context unavailable.'); return value; }
