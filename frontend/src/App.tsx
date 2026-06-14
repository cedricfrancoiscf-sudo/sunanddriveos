import React, { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './modules/auth/authContext';
import ProtectedRoute from './components/layout/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import PwaInstallBanner from './components/PwaInstallBanner';

const SYSTEM_FONTS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace']);

function applyTheme(settings: { primaryColor?: string | null; secondaryColor?: string | null; fontFamily?: string | null }): void {
  const root = document.documentElement;
  if (settings.primaryColor) root.style.setProperty('--color-primary', settings.primaryColor);
  if (settings.secondaryColor) root.style.setProperty('--color-secondary', settings.secondaryColor);
  if (settings.fontFamily) {
    if (!SYSTEM_FONTS.has(settings.fontFamily)) {
      const linkId = 'google-font-link';
      let link = document.getElementById(linkId) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      link.href = `https://fonts.googleapis.com/css2?family=${settings.fontFamily.replace(/ /g, '+')}:wght@400;500;600;700&display=swap`;
    }
    root.style.setProperty('--font-family', `'${settings.fontFamily}', system-ui, sans-serif`);
    document.body.style.fontFamily = 'var(--font-family)';
  }
}

// Exposer pour usage dans SettingsPage (prévisualisation live)
(window as unknown as Record<string, unknown>).applyTheme = applyTheme;

// Auth
const LoginPage = React.lazy(() => import('./modules/auth/LoginPage'));
const AcceptInvitationPage = React.lazy(() => import('./modules/auth/AcceptInvitationPage'));
const ForgotPasswordPage = React.lazy(() => import('./modules/auth/ForgotPasswordPage'));
const ResetPasswordPage = React.lazy(() => import('./modules/auth/ResetPasswordPage'));

// App pages
const DashboardPage = React.lazy(() => import('./modules/dashboard/DashboardPage'));
const VehicleListPage = React.lazy(() => import('./modules/vehicles/VehicleListPage'));
const VehicleDetailPage = React.lazy(() => import('./modules/vehicles/VehicleDetailPage'));
const VehicleFormPage = React.lazy(() => import('./modules/vehicles/VehicleFormPage'));
const RentalListPage = React.lazy(() => import('./modules/rentals/RentalListPage'));
const RentalDetailPage = React.lazy(() => import('./modules/rentals/RentalDetailPage'));
const MessageListPage = React.lazy(() => import('./modules/messages/MessageListPage'));
const MessageDetailPage = React.lazy(() => import('./modules/messages/MessageDetailPage'));
const SequenceListPage = React.lazy(() => import('./modules/sequences/SequenceListPage'));
const MaintenancePage = React.lazy(() => import('./modules/maintenance/MaintenancePage'));
const TechnicalControlPage = React.lazy(() => import('./modules/technical-control/TechnicalControlPage'));
const VehicleCheckListPage = React.lazy(() => import('./modules/vehicle-checks/VehicleCheckListPage'));
const VehicleCheckFormPage = React.lazy(() => import('./modules/vehicle-checks/VehicleCheckFormPage'));
const DocumentsPage = React.lazy(() => import('./modules/documents/DocumentsPage'));
const PlanningPage = React.lazy(() => import('./modules/planning/PlanningPage'));
const UsersPage = React.lazy(() => import('./modules/users/UsersPage'));
const SettingsPage = React.lazy(() => import('./modules/settings/SettingsPage'));
const AccessoriesPage = React.lazy(() => import('./modules/accessories/AccessoriesPage'));
const ExportPage = React.lazy(() => import('./modules/export/ExportPage'));
const TvDashboardPage = React.lazy(() => import('./modules/tv/TvDashboardPage'));
const ThirdPartyOwnersPage = React.lazy(() => import('./modules/third-party-owners/ThirdPartyOwnersPage'));
const SuperAdminLoginPage = React.lazy(() => import('./modules/superadmin/SuperAdminLoginPage'));
const SuperAdminDashboard = React.lazy(() => import('./modules/superadmin/SuperAdminDashboard'));
const OnboardingPage = React.lazy(() => import('./modules/onboarding/OnboardingPage'));
const IntelligencePage = React.lazy(() => import('./modules/intelligence/IntelligencePage'));
const ReportPage = React.lazy(() => import('./modules/intelligence/ReportPage'));
const TrialExpiredPage = React.lazy(() => import('./modules/billing/TrialExpiredPage'));
const RentersPage = React.lazy(() => import('./modules/renters/RentersPage'));
const RenterDetailPage = React.lazy(() => import('./modules/renters/RenterDetailPage'));
const RentabilityPage = React.lazy(() => import('./modules/rentability/RentabilityPage'));
const RatingPage = React.lazy(() => import('./modules/intelligence/RatingPage'));

function LoadingFallback(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
        style={{ borderColor: '#01696e', borderTopColor: 'transparent' }}
      />
    </div>
  );
}

function ProtectedLayout(): React.JSX.Element {
  return (
    <ProtectedRoute>
      <AppLayout />
    </ProtectedRoute>
  );
}

export default function App(): React.JSX.Element {
  useEffect(() => {
    // Applique le thème depuis les settings du tenant au démarrage
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const apiBase = (import.meta as { env: Record<string, string> }).env.VITE_API_URL ?? '/api/v1';
    fetch(`${apiBase}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: { settings?: { primaryColor?: string | null; secondaryColor?: string | null; fontFamily?: string | null } } | null) => {
        if (data?.settings) applyTheme(data.settings);
      })
      .catch(() => { /* silencieux si non connecté */ });
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <PwaInstallBanner />
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            {/* Routes publiques */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/upgrade" element={<TrialExpiredPage />} />

            {/* TV dashboard — protégé mais sans sidebar */}
            <Route path="/tv" element={<ProtectedRoute><TvDashboardPage /></ProtectedRoute>} />

            {/* Super admin — auth séparée, token localStorage superadmin_token */}
            <Route path="/superadmin/login" element={<SuperAdminLoginPage />} />
            <Route path="/superadmin" element={<SuperAdminDashboard />} />
            <Route path="/superadmin/*" element={<SuperAdminDashboard />} />

            {/* Routes protégées avec layout */}
            <Route element={<ProtectedLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/vehicles" element={<VehicleListPage />} />
              <Route path="/vehicles/new" element={<VehicleFormPage />} />
              <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
              <Route path="/vehicles/:id/edit" element={<VehicleFormPage />} />
              <Route path="/fleet/:id/edit" element={<VehicleFormPage />} />
              <Route path="/rentals" element={<RentalListPage />} />
              <Route path="/rentals/:id" element={<RentalDetailPage />} />
              <Route path="/messages" element={<MessageListPage />} />
              <Route path="/messages/:id" element={<MessageDetailPage />} />
              <Route path="/sequences" element={<SequenceListPage />} />
              <Route path="/maintenance" element={<MaintenancePage />} />
              <Route path="/technical-control" element={<TechnicalControlPage />} />
              <Route path="/vehicle-checks" element={<VehicleCheckListPage />} />
              <Route path="/vehicle-checks/new" element={<VehicleCheckFormPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/planning" element={<PlanningPage />} />
              <Route path="/users" element={<Navigate to="/settings#users" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/accessories" element={<AccessoriesPage />} />
              <Route path="/export" element={<ExportPage />} />
              <Route path="/scoring" element={<Navigate to="/renters?tab=scoring" replace />} />
              <Route path="/third-party-owners" element={<ThirdPartyOwnersPage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/intelligence" element={<IntelligencePage />} />
              <Route path="/intelligence/report" element={<ReportPage />} />
              <Route path="/intelligence/ratings" element={<RatingPage />} />
              <Route path="/renters" element={<RentersPage />} />
              <Route path="/renters/:id" element={<RenterDetailPage />} />
              <Route path="/rentability" element={<RentabilityPage />} />
              {/* Alias routes */}
              <Route path="/technical-controls" element={<Navigate to="/technical-control" replace />} />
              <Route path="/fleet" element={<Navigate to="/vehicles" replace />} />
              <Route path="/settings/users" element={<Navigate to="/settings" replace />} />
            </Route>

            {/* Redirections */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
