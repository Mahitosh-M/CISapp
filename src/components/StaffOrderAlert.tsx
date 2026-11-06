import { useEffect, useRef, useState } from 'react';
import { BellRing, PackageCheck, ShoppingCart } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useStaffOrders } from '../contexts/StaffOrdersContext';
import './StaffOrderAlert.css';
export default function StaffOrderAlert() {
  const { userProfile } = useAuth();
  const { orders, checked } = useStaffOrders();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const dialog = useRef<HTMLDivElement>(null), go = useRef<HTMLButtonElement>(null);
  const open = userProfile?.role === 'Staff' && checked && orders.length > 0 && !dismissed && pathname !== '/orders';
  useEffect(() => {
    if (pathname === '/orders') setDismissed(true);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    go.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDismissed(true);
      if (event.key !== 'Tab') return;
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [open]);
  if (!open) return null;
  return <div className="staff-order-alert-overlay"><div ref={dialog} className="staff-order-alert" role="dialog" aria-modal="true" aria-labelledby="staff-order-alert-title">
    <div className="staff-order-alert-icons" aria-hidden="true"><PackageCheck size={26} /><BellRing className="staff-order-alert-bell" size={48} /><ShoppingCart size={26} /></div>
    <h2 id="staff-order-alert-title">Orders are waiting</h2><p>{orders.length}{orders.length === 100 ? '+' : ''} open {orders.length === 1 ? 'order needs' : 'orders need'} your attention.</p>
    <button ref={go} type="button" onClick={() => { setDismissed(true); navigate('/orders'); }}><ShoppingCart size={20} />Go to Orders</button>
    <button type="button" className="staff-order-alert-later" onClick={() => setDismissed(true)}>Later</button>
  </div></div>;
}
