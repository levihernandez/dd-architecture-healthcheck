import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Overview from './pages/Overview';
import OrgConnections from './pages/OrgConnections';
import ScanRuns from './pages/ScanRuns';
import InventoryExplorer from './pages/InventoryExplorer';
import HostInstrumentationGaps from './pages/HostInstrumentationGaps';
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
import TaggingImplementationGuide from './pages/TaggingImplementationGuide';
import AIChatAssistant from './pages/AIChatAssistant';
import AISettings from './pages/AISettings';
import Analytics from './pages/Analytics';
import Calculators from './pages/Calculators';
import CloudInventory from './pages/CloudInventory';
import OrgContext from './pages/OrgContext';
import Usage from './pages/Usage';
import EventsHealth from './pages/EventsHealth';
import FeatureFlags from './pages/FeatureFlags';
import ScanComparison from './pages/ScanComparison';
import FeatureGate from './components/FeatureGate';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="orgs" element={<FeatureGate featureKey="page.orgs"><OrgConnections /></FeatureGate>} />
          <Route path="scans" element={<ScanRuns />} />
          <Route path="scan-comparison" element={<FeatureGate featureKey="page.scan_comparison"><ScanComparison /></FeatureGate>} />
          <Route path="inventory" element={<InventoryExplorer />} />
          <Route path="host-gaps" element={<FeatureGate featureKey="page.host_gaps"><HostInstrumentationGaps /></FeatureGate>} />
          <Route path="products" element={<FeatureGate featureKey="page.products"><ProductUsage /></FeatureGate>} />
          <Route path="tags" element={<FeatureGate featureKey="page.tags"><TagExplorer /></FeatureGate>} />
          <Route path="tagging-scorecard" element={<FeatureGate featureKey="page.tagging_scorecard"><UnifiedTaggingScorecard /></FeatureGate>} />
          <Route path="services" element={<FeatureGate featureKey="page.services"><ServicesServiceCatalog /></FeatureGate>} />
          <Route path="integrations" element={<FeatureGate featureKey="page.integrations"><Integrations /></FeatureGate>} />
          <Route path="logs" element={<FeatureGate featureKey="page.logs"><LogsHealth /></FeatureGate>} />
          <Route path="monitors" element={<FeatureGate featureKey="page.monitors"><MonitorsHealth /></FeatureGate>} />
          <Route path="dashboards" element={<FeatureGate featureKey="page.dashboards"><DashboardsHealth /></FeatureGate>} />
          <Route path="synthetics" element={<FeatureGate featureKey="page.synthetics"><SyntheticsHealth /></FeatureGate>} />
          <Route path="network" element={<FeatureGate featureKey="page.network"><NetworkCloud /></FeatureGate>} />
          <Route path="governance" element={<FeatureGate featureKey="page.governance"><GovernanceSSOSummary /></FeatureGate>} />
          <Route path="events" element={<FeatureGate featureKey="page.events"><EventsHealth /></FeatureGate>} />
          <Route path="tag-mapping" element={<FeatureGate featureKey="page.tag_mapping"><TagMappingDashboard /></FeatureGate>} />
          <Route path="cloud-tags" element={<FeatureGate featureKey="page.cloud_tags"><CloudTagComparison /></FeatureGate>} />
          <Route path="tag-templates" element={<IndustryTemplates />} />
          <Route path="tag-governance" element={<FeatureGate featureKey="page.tag_governance"><TagGovernance /></FeatureGate>} />
          <Route path="tagging-implementation" element={<FeatureGate featureKey="page.tagging_implementation"><TaggingImplementationGuide /></FeatureGate>} />
          <Route path="org-context" element={<OrgContext />} />
          <Route path="usage" element={<FeatureGate featureKey="page.usage"><Usage /></FeatureGate>} />
          <Route path="chat" element={<FeatureGate featureKey="page.chat"><AIChatAssistant /></FeatureGate>} />
          <Route path="ai-settings" element={<AISettings />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="calculators" element={<FeatureGate featureKey="page.calculators"><Calculators /></FeatureGate>} />
          <Route path="cloud" element={<FeatureGate featureKey="page.cloud"><CloudInventory /></FeatureGate>} />
          <Route path="ai" element={<AIAssessment />} />
          <Route path="recommendations" element={<FeatureGate featureKey="page.recommendations"><Recommendations /></FeatureGate>} />
          <Route path="export" element={<FeatureGate featureKey="page.export"><ExportCenter /></FeatureGate>} />
          <Route path="feature-flags" element={<FeatureFlags />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
