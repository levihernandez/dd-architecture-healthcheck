import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Overview from './pages/Overview';
import OrgConnections from './pages/OrgConnections';
import ScanRuns from './pages/ScanRuns';
import InventoryExplorer from './pages/InventoryExplorer';
import ProductUsage from './pages/ProductUsage';
import TagExplorer from './pages/TagExplorer';
import UnifiedTaggingScorecard from './pages/UnifiedTaggingScorecard';
import ServicesServiceCatalog from './pages/ServicesServiceCatalog';
import Integrations from './pages/Integrations';
import LogsHealth from './pages/LogsHealth';
import MonitorsHealth from './pages/MonitorsHealth';
import DashboardsHealth from './pages/DashboardsHealth';
import SyntheticsHealth from './pages/SyntheticsHealth';
import NetworkCloud from './pages/NetworkCloud';
import GovernanceSSOSummary from './pages/GovernanceSSOSummary';
import AIAssessment from './pages/AIAssessment';
import Recommendations from './pages/Recommendations';
import ExportCenter from './pages/ExportCenter';
import TagMappingDashboard from './pages/TagMappingDashboard';
import CloudTagComparison from './pages/CloudTagComparison';
import IndustryTemplates from './pages/IndustryTemplates';
import TagGovernance from './pages/TagGovernance';
import AIChatAssistant from './pages/AIChatAssistant';
import AISettings from './pages/AISettings';
import Analytics from './pages/Analytics';
import Calculators from './pages/Calculators';
import CloudInventory from './pages/CloudInventory';
import OrgContext from './pages/OrgContext';
import Usage from './pages/Usage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="orgs" element={<OrgConnections />} />
          <Route path="scans" element={<ScanRuns />} />
          <Route path="inventory" element={<InventoryExplorer />} />
          <Route path="products" element={<ProductUsage />} />
          <Route path="tags" element={<TagExplorer />} />
          <Route path="tagging-scorecard" element={<UnifiedTaggingScorecard />} />
          <Route path="services" element={<ServicesServiceCatalog />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="logs" element={<LogsHealth />} />
          <Route path="monitors" element={<MonitorsHealth />} />
          <Route path="dashboards" element={<DashboardsHealth />} />
          <Route path="synthetics" element={<SyntheticsHealth />} />
          <Route path="network" element={<NetworkCloud />} />
          <Route path="governance" element={<GovernanceSSOSummary />} />
          <Route path="tag-mapping" element={<TagMappingDashboard />} />
          <Route path="cloud-tags" element={<CloudTagComparison />} />
          <Route path="tag-templates" element={<IndustryTemplates />} />
          <Route path="tag-governance" element={<TagGovernance />} />
          <Route path="org-context" element={<OrgContext />} />
          <Route path="usage" element={<Usage />} />
          <Route path="chat" element={<AIChatAssistant />} />
          <Route path="ai-settings" element={<AISettings />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="calculators" element={<Calculators />} />
          <Route path="cloud" element={<CloudInventory />} />
          <Route path="ai" element={<AIAssessment />} />
          <Route path="recommendations" element={<Recommendations />} />
          <Route path="export" element={<ExportCenter />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
