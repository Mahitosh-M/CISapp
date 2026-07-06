import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import CustomerMobileLayout from './components/CustomerMobileLayout';
import ProtectedRoute from './components/ProtectedRoute';
import { useEnterKeyNavigation } from './hooks/useEnterKeyNavigation';
import { useNumberInputZeroSelection } from './hooks/useNumberInputZeroSelection';
import { useIsMobile } from './hooks/useIsMobile';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Customers = lazy(() => import('./pages/Customers'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Payments = lazy(() => import('./pages/Payments'));
const Intelligence = lazy(() => import('./pages/Intelligence'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Login = lazy(() => import('./pages/Login'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const Admin = lazy(() => import('./pages/Admin'));
const Loyalty = lazy(() => import('./pages/Loyalty'));
const OverduePcRequests = lazy(() => import('./pages/OverduePcRequests'));
const NotFound = lazy(() => import('./pages/NotFound'));
const CustomerDashboard = lazy(() => import('./pages/customer/CustomerDashboard'));
const CustomerInvoices = lazy(() => import('./pages/customer/CustomerInvoices'));
const CustomerPayments = lazy(() => import('./pages/customer/CustomerPayments'));
const CustomerOffers = lazy(() => import('./pages/customer/CustomerOffers'));
const CustomerProfile = lazy(() => import('./pages/customer/CustomerProfile'));
const CustomerPartnerPoints = lazy(() => import('./pages/customer/CustomerPartnerPoints'));

const AdminStaffLanding = () => {
  const isMobile = useIsMobile();

  if (isMobile) return <Navigate to="/invoices" replace />;

  return <Dashboard />;
};

const App = () => {
  useEnterKeyNavigation();
  useNumberInputZeroSelection();

  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0B1F3A', color: '#FFFFFF', padding: 24 }}>Loading...</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/customer" element={<ProtectedRoute allowedRoles={['customer']}><CustomerMobileLayout /></ProtectedRoute>}>
          <Route index element={<CustomerDashboard />} />
          <Route path="invoices" element={<CustomerInvoices />} />
          <Route path="payments" element={<CustomerPayments />} />
          <Route path="offers" element={<CustomerOffers />} />
          <Route path="partner-points" element={<CustomerPartnerPoints />} />
          <Route path="profile" element={<CustomerProfile />} />
        </Route>
        <Route path="/" element={<ProtectedRoute allowedRoles={['Admin', 'Staff']}><Layout /></ProtectedRoute>}>
          <Route index element={<AdminStaffLanding />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="customers" element={<Customers />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="payments" element={<Payments />} />
          <Route path="intelligence" element={<Intelligence />} />
          <Route path="analytics" element={<ProtectedRoute allowedRoles={['Admin']}><Analytics /></ProtectedRoute>} />
          <Route path="loyalty" element={<ProtectedRoute allowedRoles={['Admin']}><Loyalty /></ProtectedRoute>} />
          <Route path="overdue-pc-requests" element={<ProtectedRoute allowedRoles={['Admin']}><OverduePcRequests /></ProtectedRoute>} />
          <Route path="reports" element={<ProtectedRoute allowedRoles={['Admin', 'Staff']}><Reports /></ProtectedRoute>} />
          <Route path="admin" element={<ProtectedRoute allowedRoles={['Admin']}><Admin /></ProtectedRoute>} />
          <Route path="settings" element={<ProtectedRoute allowedRoles={['Admin']}><Settings /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};

export default App;
