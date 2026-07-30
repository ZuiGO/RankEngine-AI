import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { MotionConfig } from 'framer-motion';

import Layout from './components/Layout';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import SettingsPage from './pages/SettingsPage';
import KeywordResearchPage from './pages/KeywordResearchPage';
import BacklinksPage from './pages/BacklinksPage';
import AiVisibilityPage from './pages/AiVisibilityPage';
import CompetitorsPage from './pages/CompetitorsPage';
import ContentEditorPage from './pages/ContentEditorPage';
import KeywordClusteringPage from './pages/KeywordClusteringPage';
import CwvPage from './pages/CwvPage';
import InternalLinksPage from './pages/InternalLinksPage';
import ChatPage from './pages/ChatPage';
import KeywordsPage from './pages/KeywordsPage';
import NotificationsPage from './pages/NotificationsPage';
import ProjectSettingsPage from './pages/ProjectSettingsPage';
import ContentPerformancePage from './pages/ContentPerformancePage';
import ComparisonReportPage from './pages/ComparisonReportPage';

export default function App() {
  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/projects/:id/content-editor" element={<ContentEditorPage />} />
            <Route path="/projects/:id/content-writer" element={<Navigate to="../content-editor" replace />} />
            <Route path="/projects/:id/keywords" element={<KeywordsPage />} />
            <Route path="/projects/:id/keyword-clustering" element={<KeywordClusteringPage />} />
            <Route path="/projects/:id/cwv" element={<CwvPage />} />
            <Route path="/projects/:id/internal-links" element={<InternalLinksPage />} />
            <Route path="/projects/:id/chat" element={<ChatPage />} />
            <Route path="/projects/:id/backlinks" element={<BacklinksPage />} />
            <Route path="/projects/:id/ai-visibility" element={<AiVisibilityPage />} />
            <Route path="/projects/:id/competitors" element={<CompetitorsPage />} />
            <Route path="/projects/:id/settings" element={<ProjectSettingsPage />} />
            <Route path="/projects/:id/reports/content-performance" element={<ContentPerformancePage />} />
            <Route path="/projects/:id/reports/comparison" element={<ComparisonReportPage />} />
            <Route path="/keyword-research" element={<KeywordResearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MotionConfig>
    </BrowserRouter>
  );
}
