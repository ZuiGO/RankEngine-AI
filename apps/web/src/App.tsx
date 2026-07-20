import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';

import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <NotificationProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/projects/:id/content-editor" element={<ContentEditorPage />} />
                <Route path="/projects/:id/keywords" element={<KeywordsPage />} />
                <Route path="/projects/:id/backlinks" element={<BacklinksPage />} />
                <Route path="/projects/:id/ai-visibility" element={<AiVisibilityPage />} />
                <Route path="/projects/:id/competitors" element={<CompetitorsPage />} />
                <Route path="/keyword-research" element={<KeywordResearchPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/pricing" element={<PricingPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </NotificationProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

