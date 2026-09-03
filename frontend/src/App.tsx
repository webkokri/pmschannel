import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { PropertyProvider } from '@/lib/property';
import { Layout } from '@/components/Layout';
import { Spinner } from '@/components/ui';
import { LoginPage } from '@/pages/Login';
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

export function App() {
  const { user, loading } = useAuth();

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
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <PropertyProvider>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
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
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </PropertyProvider>
  );
}
