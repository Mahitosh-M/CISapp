import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import CustomerMobileLayout from './components/CustomerMobileLayout';
import ProtectedRoute from './components/ProtectedRoute';
import SplashScreen from './components/SplashScreen';
import { useAuth } from './contexts/AuthContext';
import { useEnterKeyNavigation } from './hooks/useEnterKeyNavigation';
import { useNumberInputZeroSelection } from './hooks/useNumberInputZeroSelection';

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
const CustomerOffers = lazy(() => import('./pages/customer/CustomerOffers'));
const CustomerProfile = lazy(() => import('./pages/customer/CustomerProfile'));
const CustomerPartnerPoints = lazy(() => import('./pages/customer/CustomerPartnerPoints'));

const AdminStaffLanding = () => {
  return <Navigate to="/invoices" replace />;
};

const RootRouteShell = () => {
  const { role } = useAuth();

  if (role === 'customer') {
    return <Navigate to="/customer" replace />;
  }

  return (
    <ProtectedRoute allowedRoles={['Admin', 'Staff']}>
      <Layout />
    </ProtectedRoute>
  );
};

const App = () => {
  useEnterKeyNavigation();
  useNumberInputZeroSelection();
  const { loading } = useAuth();
  const [minimumSplashComplete, setMinimumSplashComplete] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => setMinimumSplashComplete(true), 1300);
    return () => window.clearTimeout(timerId);
  }, []);

  if (loading || !minimumSplashComplete) {
    return <SplashScreen />;
  }

  return (
    <Suspense fallback={<SplashScreen />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/customer" element={<ProtectedRoute allowedRoles={['customer']}><CustomerMobileLayout /></ProtectedRoute>}>
          <Route index element={<CustomerDashboard />} />
          <Route path="invoices" element={<CustomerInvoices />} />
          <Route path="payments" element={<Navigate to="/customer" replace />} />
          <Route path="offers" element={<CustomerOffers />} />
          <Route path="partner-points" element={<CustomerPartnerPoints />} />
          <Route path="profile" element={<CustomerProfile />} />
        </Route>
        <Route path="/" element={<RootRouteShell />}>
          <Route index element={<AdminStaffLanding />} />
          <Route path="dashboard" element={<Navigate to="/invoices" replace />} />
          <Route path="customers" element={<Customers />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="payments" element={<Payments />} />
          <Route path="intelligence" element={<ProtectedRoute allowedRoles={['Admin']}><Intelligence /></ProtectedRoute>} />
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
