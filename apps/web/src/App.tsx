import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { MotionConfig } from 'framer-motion';

import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import SettingsPage from './pages/SettingsPage';
import OnboardingPage from './pages/OnboardingPage';
import KeywordResearchPage from './pages/KeywordResearchPage';
import BacklinksPage from './pages/BacklinksPage';
import AiVisibilityPage from './pages/AiVisibilityPage';
import CompetitorsPage from './pages/CompetitorsPage';
import ContentEditorPage from './pages/ContentEditorPage';
import KeywordsPage from './pages/KeywordsPage';
import PricingPage from './pages/PricingPage';
import BillingPage from './pages/BillingPage';
import TeamPage from './pages/TeamPage';
import BrandingPage from './pages/BrandingPage';

import DevScoreRevealPage from './pages/DevScoreRevealPage';

/*
 * Root route handler — shows the LandingPage for unauthenticated visitors
 * and redirects to /dashboard for logged-in users.
 */
function HomeRoute() {
  const { token } = useAuth();
  if (token) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <NotificationProvider>
          <MotionConfig reducedMotion="user">
          <Routes>
            {import.meta.env.DEV && <Route path="/dev/score-reveal" element={<DevScoreRevealPage />} />}
            <Route path="/" element={<HomeRoute />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/projects/:id/content-editor" element={<ContentEditorPage />} />
                <Route path="/projects/:id/keywords" element={<KeywordsPage />} />
                <Route path="/projects/:id/backlinks" element={<BacklinksPage />} />
                <Route path="/projects/:id/ai-visibility" element={<AiVisibilityPage />} />
                <Route path="/projects/:id/competitors" element={<CompetitorsPage />} />
                <Route path="/keyword-research" element={<KeywordResearchPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/team" element={<TeamPage />} />
                <Route path="/settings/branding" element={<BrandingPage />} />
                <Route path="/settings/billing" element={<BillingPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MotionConfig>
        </NotificationProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

