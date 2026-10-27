import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { PropertyProvider } from '@/lib/property';
import { Layout } from '@/components/Layout';
import { AdminLayout } from '@/components/AdminLayout';
import { Spinner } from '@/components/ui';
import { LoginPage } from '@/pages/Login';
import { SignupPage } from '@/pages/Signup';
import { PublicPropertyPage } from '@/pages/public/PropertyPage';
import { DashboardPage } from '@/pages/Dashboard';
import { ChannelsPage } from '@/pages/Channels';
import { ChannelDetailPage } from '@/pages/ChannelDetail';
import { CalendarPage } from '@/pages/Calendar';
import { BookingsPage } from '@/pages/Bookings';
import { ConflictsPage } from '@/pages/Conflicts';
import { SyncPage } from '@/pages/Sync';
import { SimulatorPage } from '@/pages/Simulator';
import { PropertiesPage } from '@/pages/Properties';
import { SettingsPage } from '@/pages/Settings';
import { BillingPage } from '@/pages/Billing';
import { StaffPage } from '@/pages/Staff';
import { FinancePage } from '@/pages/Finance';
import { PackagesPage } from '@/pages/Packages';
import { ReportsPage } from '@/pages/Reports';
import { PmsPage } from '@/pages/Pms';
import { RmsPage } from '@/pages/Rms';
import { SeoPage } from '@/pages/Seo';
import { AcceleratorPage } from '@/pages/Accelerator';
import { AdminOverviewPage } from '@/pages/admin/Overview';
import { AdminOrganizationsPage } from '@/pages/admin/Organizations';
import { AdminPlansPage } from '@/pages/admin/Plans';
import { AdminChannelsPage } from '@/pages/admin/Channels';
import { AdminSettingsPage } from '@/pages/admin/Settings';

export function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // The public booking microsite is available regardless of auth state, and shouldn't
  // wait on the admin session to resolve.
  if (location.pathname.startsWith('/book/')) {
    return (
      <Routes>
        <Route path="/book/:code" element={<PublicPropertyPage />} />
      </Routes>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Starting Channel Manager…" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Platform super admins get their own console — no organization/property context.
  if (user.isSuperAdmin) {
    return (
      <Routes>
        <Route path="/login" element={<Navigate to="/admin" replace />} />
        <Route path="/signup" element={<Navigate to="/admin" replace />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminOverviewPage />} />
          <Route path="organizations" element={<AdminOrganizationsPage />} />
          <Route path="plans" element={<AdminPlansPage />} />
          <Route path="channels" element={<AdminChannelsPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    );
  }

  return (
    <PropertyProvider>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/signup" element={<Navigate to="/" replace />} />
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="channels" element={<ChannelsPage />} />
          <Route path="channels/:connectionId" element={<ChannelDetailPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="conflicts" element={<ConflictsPage />} />
          <Route path="sync" element={<SyncPage />} />
          <Route path="simulator" element={<SimulatorPage />} />
          <Route path="properties" element={<PropertiesPage />} />
          <Route path="pms" element={<PmsPage />} />
          <Route path="rms" element={<RmsPage />} />
          <Route path="packages" element={<PackagesPage />} />
          <Route path="finance" element={<FinancePage />} />
          <Route path="accelerator" element={<AcceleratorPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="seo" element={<SeoPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </PropertyProvider>
  );
}
