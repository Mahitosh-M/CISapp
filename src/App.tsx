import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import CustomerMobileLayout from './components/CustomerMobileLayout';
import ProtectedRoute from './components/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import Invoices from './pages/Invoices';
import Payments from './pages/Payments';
import Intelligence from './pages/Intelligence';
import Analytics from './pages/Analytics';
import Gifts from './pages/Gifts';
import SuggestedGifts from './pages/SuggestedGifts';
import Login from './pages/Login';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import NotFound from './pages/NotFound';
import CustomerDashboard from './pages/customer/CustomerDashboard';
import CustomerInvoices from './pages/customer/CustomerInvoices';
import CustomerPayments from './pages/customer/CustomerPayments';
import CustomerOffers from './pages/customer/CustomerOffers';
import CustomerProfile from './pages/customer/CustomerProfile';
import { useNumberInputZeroSelection } from './hooks/useNumberInputZeroSelection';

const App = () => {
  useNumberInputZeroSelection();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/customer" element={<ProtectedRoute allowedRoles={['customer']}><CustomerMobileLayout /></ProtectedRoute>}>
        <Route index element={<CustomerDashboard />} />
        <Route path="invoices" element={<CustomerInvoices />} />
        <Route path="payments" element={<CustomerPayments />} />
        <Route path="offers" element={<CustomerOffers />} />
        <Route path="profile" element={<CustomerProfile />} />
      </Route>
      <Route path="/" element={<ProtectedRoute allowedRoles={['Admin', 'Staff']}><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="customers" element={<Customers />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="payments" element={<Payments />} />
        <Route path="intelligence" element={<Intelligence />} />
        <Route path="analytics" element={<ProtectedRoute allowedRoles={['Admin']}><Analytics /></ProtectedRoute>} />
        <Route path="gifts" element={<ProtectedRoute allowedRoles={['Admin']}><Gifts /></ProtectedRoute>} />
        <Route path="suggested-gifts" element={<ProtectedRoute allowedRoles={['Admin', 'Staff']}><SuggestedGifts /></ProtectedRoute>} />
        <Route path="reports" element={<ProtectedRoute allowedRoles={['Admin', 'Staff']}><Reports /></ProtectedRoute>} />
        <Route path="admin" element={<ProtectedRoute allowedRoles={['Admin']}><Admin /></ProtectedRoute>} />
        <Route path="settings" element={<ProtectedRoute allowedRoles={['Admin']}><Settings /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
