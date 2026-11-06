import { ShoppingCart } from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import { useStaffOrders } from '../contexts/StaffOrdersContext';
import { staffOrderUrl } from '../services/orderAppService';
export default function StaffOrders() {
  const { orders, loading, error, refresh } = useStaffOrders();
  return <section style={{ color: '#fff' }}>
    <SectionHeader title="Orders" />
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
      <button type="button" disabled={loading} onClick={() => void refresh()}>{loading ? 'Loading…' : 'Refresh orders'}</button>
      <a href={staffOrderUrl()} target="_blank" rel="noopener noreferrer" style={{ color: '#fde68a' }}>Open Orderapp</a>
    </div>
    {error && <p role="alert">{error}</p>}
    {!loading && !error && orders.length === 0 && <p>No open orders.</p>}
    <div style={{ display: 'grid', gap: 18 }}>{orders.map(order => <article key={order.id} style={{ padding: 18, border: '2px solid #d4af37', borderRadius: 16, background: '#11185a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><h2 style={{ fontSize: 20, margin: 0 }}>{order.customerName}</h2><strong style={{ color: '#fde68a' }}>{order.status === 'pending' ? 'Pending' : 'Confirmed'}</strong></div>
      <p>{order.customerArea} · {order.orderNumber}{order.createdAt?.toDate ? ' · ' + order.createdAt.toDate().toLocaleDateString('en-IN') : ''}</p>
      <p>{order.totalProducts} products · {order.totalQuantity} units · {order.deliveryPreference ?? ''}</p>
      <div style={{ overflowWrap: 'anywhere' }}>{order.items?.map((item, index) => <div key={item.productId + index} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid #ffffff24', padding: '10px 0' }}><span>{item.productName}{item.packing ? ' · ' + item.packing : ''}</span><strong>× {item.quantity}</strong></div>)}</div>
      {order.customerNote && <p>{order.customerNote}</p>}
      <a href={staffOrderUrl(order.id)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minHeight: 44, color: '#fde68a', fontWeight: 800 }}><ShoppingCart size={18} />Manage order</a>
    </article>)}</div>
    {orders.length === 100 && <p>Showing up to 100 open orders.</p>}
  </section>;
}
