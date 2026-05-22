import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LayoutShell } from "@/components/layout-shell";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, Component } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Loader2, ShieldOff } from "lucide-react";
import type { Role } from "@shared/schema";
import { MGMT_CONFIGURABLE_FEATURES } from "@shared/schema";

class GlobalErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace", color: "#f87171", background: "#0a0a0a", minHeight: "100vh" }}>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>⚠ Application Error</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "0.75rem", background: "#111", padding: "1rem", borderRadius: "0.5rem" }}>
            {this.state.error.toString()}{"\n\n"}{this.state.error.stack}
          </pre>
          <button
            style={{ marginTop: "1rem", color: "#60a5fa", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { ThemeProvider } from "@/hooks/use-theme";
import { TimezoneProvider } from "@/context/timezone-context";
import { OrgScopeProvider } from "@/context/org-scope-context";
import ApiKeysPage from "@/pages/api-keys";
import TestCallPage from "@/pages/test-call";
import LcrAnalyserPage from "@/pages/lcr-analyser";
import CallFlowSimulatorPage from "@/pages/call-flow-simulator";
import VendorSlaScorecardPage from "@/pages/vendor-sla-scorecard";
import CarrierScoringPage from "@/pages/carrier-scoring";
import CostOptimisationPage from "@/pages/cost-optimisation";
import MultiSwitchPage from "@/pages/multi-switch";
import WhatsappAlertsPage from "@/pages/whatsapp-alerts";
import AccountNamesPage from "@/pages/account-names";
import DashboardPage from "@/pages/dashboard";
import CallsListPage from "@/pages/calls-list";
import CallDetailPage from "@/pages/call-detail";
import AlertsPage from "@/pages/alerts";
import SettingsPage from "@/pages/settings";
import ReportsPage from "@/pages/reports";
import TeamPage from "@/pages/team";
import ClientsPage from "@/pages/clients";
import FraudPage from "@/pages/fraud";
import CDRsPage from "@/pages/cdrs";
import ToolsPage from "@/pages/tools";
import AccountPage from "@/pages/account";
import LoginPage from "@/pages/login";
import TrafficMapPage from "@/pages/traffic-map";
import BalanceMonitorPage from "@/pages/balance-monitor";
import DIDsPage from "@/pages/dids";
import ServerMonitoringPage from "@/pages/server-monitoring";
import GraphsPage from "@/pages/graphs";
import BitsEyePage from "@/pages/bitseye";
import BitsEye2Page from "@/pages/bitseye2";
import RateCardsPage from "@/pages/rate-cards";
import AnalyticsPage from "@/pages/analytics";
import ProductsPage from "@/pages/products";
import NotFound from "@/pages/not-found";
import QosHeatmapPage from "@/pages/qos-heatmap";
import SlaBreachesPage from "@/pages/sla-breaches";
import BillingDisputesPage from "@/pages/billing-disputes";
import TestCampaignsPage from "@/pages/test-campaigns";
import ChatPage from "@/pages/chat";
import FirewallPage from "@/pages/firewall";
import VpnConfigPage from "@/pages/vpn-config";
import EmailCentrePage from "@/pages/email-centre";
import RoutingManagerPage from "@/pages/routing-manager";
import ApprovalQueuePage from "@/pages/approval-queue";
import VendorsPage from "@/pages/vendors";
import ApprovalSettingsPage from "@/pages/approval-settings";
import CompanyProfilePage from "@/pages/company-profile";
import SipTracePage from "@/pages/sip-trace";
import RoutingIntelligencePage from "@/pages/routing-intelligence";
import NumberIntelligencePage from "@/pages/number-intelligence";
import SbcMonitorPage from "@/pages/sbc-monitor";
import ClientPortalPage from "@/pages/client-portal";
import ResellerPage from "@/pages/reseller";
import CompliancePage from "@/pages/compliance";
import SmsMonitorPage from "@/pages/sms-monitor";
import AiOpsPage from "@/pages/ai-ops";
import CarrierIntelligencePage from "@/pages/carrier-intelligence";
import IntelligencePage from "@/pages/intelligence";
import IntelligenceValidationPage from "@/pages/intelligence-validation";
import VendorPrefixIntelligencePage from "@/pages/vendor-prefix-intelligence";
import VendorStabilityTimelinePage from "@/pages/vendor-stability-timeline";
import VendorRcaPage from "@/pages/vendor-rca";
import RtpAnalyticsPage from "@/pages/rtp-analytics";
import ReplayEnginePage from "@/pages/replay";
import NetworkTopologyPage from "@/pages/network-topology";
import NocCommandPage from "@/pages/noc-command";
import OpsConsolePage from "@/pages/ops-console";
import ConsolePage from "@/pages/console";
import VendorProfilePage from "@/pages/vendor-profile";
import StirShakenPage from "@/pages/stir-shaken";
import CallRecordingsPage from "@/pages/call-recordings";
import PortalViewPage from "@/pages/portal-view";
import SelfHealPage from "@/pages/self-heal";
import SidebarSettingsPage from "@/pages/sidebar-settings";
import CompanyListPage from "@/pages/company-list";
import CompanyCreatePage from "@/pages/company-create";
import ClientWizardPage from "@/pages/client-wizard";
import ClientConfigPage from "@/pages/client-config";
import RevenueHeatmapPage from "@/pages/revenue-heatmap";
import CodecAnalyticsPage from "@/pages/codec-analytics";
import TrafficForecastPage from "@/pages/traffic-forecast";
import AuditLogPage from "@/pages/audit-log";
import AsrAcdReportPage from "@/pages/asr-acd-report";
import LiveTrafficPage from "@/pages/live-traffic";
import NotificationCentrePage from "@/pages/notification-centre";
import BillingPage from "@/pages/billing";

// Pages accessible to each role
const ROLE_PATHS: Record<Role, string[]> = {
  super_admin:  ['/', '/calls', '/alerts', '/reports', '/settings', '/team', '/approvals'],
  admin:        ['/', '/calls', '/alerts', '/reports', '/settings', '/team', '/approvals'],
  noc_operator: ['/', '/calls', '/approvals'],
  team_lead:    ['/', '/calls', '/approvals'],
  management:   ['/', '/calls', '/alerts', '/reports'],
  viewer:       ['/', '/calls'],
};

// Build a quick lookup: route → feature key (used by ProtectedRoute)
const MGMT_FEATURE_BY_ROUTE: Record<string, string> = Object.fromEntries(
  MGMT_CONFIGURABLE_FEATURES.map(f => [f.route, f.key])
);

function ProtectedRoute({
  component: Component,
  requiredRoles,
  viewerAssignment,
  mgmtFeature,
}: {
  component: React.ComponentType<any>;
  requiredRoles?: Role[];
  viewerAssignment?: string;
  mgmtFeature?: string;
}) {
  const { user, role, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  // For viewers: check if they have the required assignment to access this page
  const needsAssignmentCheck = !isLoading && !!user && role === 'viewer' && !!viewerAssignment && !!requiredRoles && !requiredRoles.includes('viewer');
  const { data: assignmentsData, isLoading: assignmentsLoading } = useQuery<{ items: string[] }>({
    queryKey: ['/api/user/monitoring-assignments'],
    enabled: needsAssignmentCheck,
    staleTime: 60_000,
  });

  // For management users on mgmtFeature-gated routes: check if feature is enabled by admin
  const needsMgmtCheck = !isLoading && !!user && role === 'management' && !!mgmtFeature;
  const { data: mgmtPerms, isLoading: mgmtPermsLoading } = useQuery<{ enabledFeatures: string[] }>({
    queryKey: ['/api/settings/mgmt-permissions'],
    enabled: needsMgmtCheck,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading || (needsAssignmentCheck && assignmentsLoading) || (needsMgmtCheck && mgmtPermsLoading)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  // Role-based access check
  if (requiredRoles && !requiredRoles.includes(role)) {
    // Viewers with a matching assignment are granted access
    if (role === 'viewer' && viewerAssignment && assignmentsData?.items?.includes(viewerAssignment)) {
      return (
        <LayoutShell>
          <Component />
        </LayoutShell>
      );
    }

    // Access denied
    return (
      <LayoutShell>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
          <ShieldOff className="w-14 h-14 text-muted-foreground/30" />
          <h2 className="text-2xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground max-w-sm">
            Your <span className="font-semibold capitalize">{role}</span> role does not have permission to view this page.
            Contact your Admin to request access.
          </p>
        </div>
      </LayoutShell>
    );
  }

  // Management feature gate: admin controls which configurable features management can access
  if (role === 'management' && mgmtFeature && mgmtPerms) {
    const enabled = mgmtPerms.enabledFeatures ?? [];
    if (!enabled.includes(mgmtFeature)) {
      return (
        <LayoutShell>
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
            <ShieldOff className="w-14 h-14 text-muted-foreground/30" />
            <h2 className="text-2xl font-bold">Feature Not Enabled</h2>
            <p className="text-muted-foreground max-w-sm">
              Your Admin has not enabled this feature for the Management role.
              Contact your Admin to request access.
            </p>
          </div>
        </LayoutShell>
      );
    }
  }

  const isCompact = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('compact') === '1';
  if (isCompact) return <Component />;

  return (
    <LayoutShell>
      <Component />
    </LayoutShell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />

      <Route path="/">
        {() => <ProtectedRoute component={DashboardPage} requiredRoles={['admin','management','viewer']} />}
      </Route>
      <Route path="/calls">
        {() => <ProtectedRoute component={CallsListPage} requiredRoles={['admin','management','viewer']} />}
      </Route>
      <Route path="/calls/:id">
        {() => <ProtectedRoute component={CallDetailPage} requiredRoles={['admin','management','viewer']} />}
      </Route>
      <Route path="/alerts">
        {() => <ProtectedRoute component={AlertsPage} requiredRoles={['admin','management','super_admin','noc_operator','team_lead']} viewerAssignment="alerts" mgmtFeature="alerts" />}
      </Route>
      <Route path="/reports">
        {() => <ProtectedRoute component={ReportsPage} requiredRoles={['admin','management']} viewerAssignment="reports" mgmtFeature="reports" />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={SettingsPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/clients">
        {() => <ProtectedRoute component={ClientsPage} requiredRoles={['admin','management']} mgmtFeature="clients" />}
      </Route>
      <Route path="/fraud">
        {() => <ProtectedRoute component={FraudPage} requiredRoles={['admin','management']} viewerAssignment="fraud_fas" mgmtFeature="fraud_fas" />}
      </Route>
      <Route path="/cdrs">
        {() => <ProtectedRoute component={CDRsPage} requiredRoles={['admin','management']} viewerAssignment="cdr_viewer" mgmtFeature="cdr_viewer" />}
      </Route>
      <Route path="/tools">
        {() => <ProtectedRoute component={ToolsPage} requiredRoles={['admin','management']} mgmtFeature="tools" />}
      </Route>
      <Route path="/team">
        {() => <ProtectedRoute component={TeamPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/traffic-map">
        {() => <ProtectedRoute component={TrafficMapPage} requiredRoles={['admin','management']} viewerAssignment="traffic_map" mgmtFeature="traffic_map" />}
      </Route>
      <Route path="/revenue-heatmap">
        {() => <ProtectedRoute component={RevenueHeatmapPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/codec-analytics">
        {() => <ProtectedRoute component={CodecAnalyticsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/traffic-forecast">
        {() => <ProtectedRoute component={TrafficForecastPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/audit-log">
        {() => <ProtectedRoute component={AuditLogPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/balance">
        {() => <ProtectedRoute component={BalanceMonitorPage} requiredRoles={['admin','management']} viewerAssignment="balance_monitor" mgmtFeature="balance_monitor" />}
      </Route>
      <Route path="/dids">
        {() => <ProtectedRoute component={DIDsPage} requiredRoles={['admin','management']} viewerAssignment="did_management" mgmtFeature="did_management" />}
      </Route>
      <Route path="/server-monitoring">
        {() => <ProtectedRoute component={ServerMonitoringPage} requiredRoles={['admin','management']} viewerAssignment="server_monitoring" mgmtFeature="server_monitoring" />}
      </Route>
      <Route path="/graphs">
        {() => <ProtectedRoute component={GraphsPage} requiredRoles={['admin','management']} viewerAssignment="graphs" mgmtFeature="graphs" />}
      </Route>
      <Route path="/bitseye">
        {() => <ProtectedRoute component={BitsEyePage} requiredRoles={['admin','management']} viewerAssignment="bitseye" mgmtFeature="bitseye" />}
      </Route>
      <Route path="/bitseye2">
        {() => <ProtectedRoute component={BitsEye2Page} requiredRoles={['admin','management']} viewerAssignment="bitseye" mgmtFeature="bitseye" />}
      </Route>
      <Route path="/live-traffic">
        {() => <ProtectedRoute component={LiveTrafficPage} requiredRoles={['admin','management','noc_operator','viewer','team_lead','super_admin']} />}
      </Route>
      <Route path="/asr-acd">
        {() => <ProtectedRoute component={AsrAcdReportPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/account">
        {() => <ProtectedRoute component={AccountPage} requiredRoles={['admin','management','viewer']} />}
      </Route>
      <Route path="/rate-cards">
        {() => <ProtectedRoute component={RateCardsPage} requiredRoles={['admin','management']} mgmtFeature="rate_cards" />}
      </Route>
      <Route path="/analytics">
        {() => <ProtectedRoute component={AnalyticsPage} requiredRoles={['admin','management']} mgmtFeature="analytics" />}
      </Route>
      <Route path="/api-keys">
        {() => <ProtectedRoute component={ApiKeysPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/test-call">
        {() => <ProtectedRoute component={TestCallPage} requiredRoles={['admin','management']} mgmtFeature="test_call" />}
      </Route>
      <Route path="/lcr-analyser">
        {() => <ProtectedRoute component={LcrAnalyserPage} requiredRoles={['admin','management']} mgmtFeature="lcr_analyser" />}
      </Route>
      <Route path="/call-flow-simulator">
        {() => <ProtectedRoute component={CallFlowSimulatorPage} requiredRoles={['admin','management']} mgmtFeature="call_flow_simulator" />}
      </Route>
      <Route path="/vendor-sla-scorecard">
        {() => <ProtectedRoute component={VendorSlaScorecardPage} requiredRoles={['admin','management']} mgmtFeature="vendor_sla" />}
      </Route>
      <Route path="/carrier-scoring">
        {() => <ProtectedRoute component={CarrierScoringPage} requiredRoles={['admin','management','super_admin','noc_operator','team_lead']} mgmtFeature="carrier_scoring" />}
      </Route>
      <Route path="/cost-optimisation">
        {() => <ProtectedRoute component={CostOptimisationPage} requiredRoles={['admin','management']} mgmtFeature="cost_optimisation" />}
      </Route>
      <Route path="/multi-switch">
        {() => <ProtectedRoute component={MultiSwitchPage} requiredRoles={['admin','management']} mgmtFeature="multi_switch" />}
      </Route>
      <Route path="/whatsapp-alerts">
        {() => <ProtectedRoute component={WhatsappAlertsPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/account-names">
        {() => <ProtectedRoute component={AccountNamesPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/products">
        {() => <ProtectedRoute component={ProductsPage} requiredRoles={['admin','management']} mgmtFeature="products" />}
      </Route>

      <Route path="/qos-heatmap">
        {() => <ProtectedRoute component={QosHeatmapPage} requiredRoles={['admin','management']} mgmtFeature="qos_heatmap" />}
      </Route>
      <Route path="/sla-breaches">
        {() => <ProtectedRoute component={SlaBreachesPage} requiredRoles={['admin','management']} mgmtFeature="sla_breaches" />}
      </Route>
      <Route path="/billing-disputes">
        {() => <ProtectedRoute component={BillingDisputesPage} requiredRoles={['admin','management']} mgmtFeature="billing_disputes" />}
      </Route>
      <Route path="/test-campaigns">
        {() => <ProtectedRoute component={TestCampaignsPage} requiredRoles={['admin','management']} mgmtFeature="test_campaigns" />}
      </Route>
      <Route path="/chat">
        {() => <ProtectedRoute component={ChatPage} requiredRoles={['admin','management','viewer']} />}
      </Route>
      <Route path="/firewall">
        {() => <ProtectedRoute component={FirewallPage} requiredRoles={['admin','management']} mgmtFeature="firewall" />}
      </Route>
      <Route path="/vpn-config">
        {() => <ProtectedRoute component={VpnConfigPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/email-centre">
        {() => <ProtectedRoute component={EmailCentrePage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/notification-centre">
        {() => <ProtectedRoute component={NotificationCentrePage} requiredRoles={['admin', 'management']} />}
      </Route>
      <Route path="/billing">
        {() => <ProtectedRoute component={BillingPage} requiredRoles={['admin', 'management']} />}
      </Route>
      <Route path="/routing-manager">
        {() => <ProtectedRoute component={RoutingManagerPage} requiredRoles={['admin', 'management']} mgmtFeature="routing_manager" />}
      </Route>
      <Route path="/approvals">
        {() => <ProtectedRoute component={ApprovalQueuePage} requiredRoles={['admin', 'management', 'super_admin', 'noc_operator', 'team_lead']} mgmtFeature="approval_queue" />}
      </Route>
      <Route path="/vendors">
        {() => <ProtectedRoute component={VendorsPage} requiredRoles={['admin', 'management']} mgmtFeature="vendor_connections" />}
      </Route>
      <Route path="/vendors/:name">
        {() => <ProtectedRoute component={VendorProfilePage} requiredRoles={['admin', 'management']} />}
      </Route>
      <Route path="/approval-settings">
        {() => <ProtectedRoute component={ApprovalSettingsPage} requiredRoles={['admin', 'super_admin']} />}
      </Route>
      <Route path="/company-profile">
        {() => <ProtectedRoute component={CompanyProfilePage} requiredRoles={['admin', 'management']} mgmtFeature="company_profile" />}
      </Route>
      <Route path="/sip-trace">
        {() => <ProtectedRoute component={SipTracePage} requiredRoles={['admin','management']} mgmtFeature="sip_trace" />}
      </Route>
      <Route path="/routing-intelligence">
        {() => <ProtectedRoute component={RoutingIntelligencePage} requiredRoles={['admin','management']} mgmtFeature="routing_intelligence" />}
      </Route>
      <Route path="/number-intelligence">
        {() => <ProtectedRoute component={NumberIntelligencePage} requiredRoles={['admin','management']} mgmtFeature="number_intelligence" />}
      </Route>
      <Route path="/sbc-monitor">
        {() => <ProtectedRoute component={SbcMonitorPage} requiredRoles={['admin','management','super_admin','noc_operator','team_lead']} mgmtFeature="sbc_monitor" />}
      </Route>
      <Route path="/client-portal">
        {() => <ProtectedRoute component={ClientPortalPage} requiredRoles={['admin','management']} mgmtFeature="client_portal" />}
      </Route>
      <Route path="/reseller">
        {() => <ProtectedRoute component={ResellerPage} requiredRoles={['admin','management']} mgmtFeature="reseller" />}
      </Route>
      <Route path="/compliance">
        {() => <ProtectedRoute component={CompliancePage} requiredRoles={['admin','management']} mgmtFeature="compliance" />}
      </Route>
      <Route path="/sms-monitor">
        {() => <ProtectedRoute component={SmsMonitorPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/ai-ops">
        {() => <ProtectedRoute component={AiOpsPage} requiredRoles={['admin','management','super_admin','noc_operator','team_lead']} mgmtFeature="ai_ops" />}
      </Route>
      <Route path="/aiops">
        {() => <ProtectedRoute component={AiOpsPage} requiredRoles={['admin','management','super_admin','noc_operator','team_lead']} mgmtFeature="ai_ops" />}
      </Route>
      <Route path="/carrier-intelligence">
        {() => <ProtectedRoute component={CarrierIntelligencePage} requiredRoles={['admin','management','super_admin','noc_operator','team_lead']} />}
      </Route>
      <Route path="/intelligence">
        {() => <ProtectedRoute component={IntelligencePage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/intelligence-validation">
        {() => <ProtectedRoute component={IntelligenceValidationPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/vendor-prefix-intelligence">
        {() => <ProtectedRoute component={VendorPrefixIntelligencePage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/vendor-stability-timeline">
        {() => <ProtectedRoute component={VendorStabilityTimelinePage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/vendor-rca">
        {() => <ProtectedRoute component={VendorRcaPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/rtp-analytics">
        {() => <ProtectedRoute component={RtpAnalyticsPage} requiredRoles={['admin','management']} mgmtFeature="rtp_analytics" />}
      </Route>
      <Route path="/replay">
        {() => <ProtectedRoute component={ReplayEnginePage} requiredRoles={['admin','management']} mgmtFeature="replay" />}
      </Route>
      <Route path="/network-topology">
        {() => <ProtectedRoute component={NetworkTopologyPage} requiredRoles={['admin','management']} mgmtFeature="network_topology" />}
      </Route>
      <Route path="/noc-command">
        {() => <ProtectedRoute component={NocCommandPage} requiredRoles={['admin','management','super_admin','noc_operator','team_lead']} mgmtFeature="noc_command" />}
      </Route>
      <Route path="/ops-console">
        {() => <ProtectedRoute component={OpsConsolePage} requiredRoles={['admin','management','super_admin','noc_operator','team_lead']} />}
      </Route>
      <Route path="/console">
        {() => <ProtectedRoute component={ConsolePage} requiredRoles={['admin','management','noc_operator','team_lead','super_admin']} />}
      </Route>
      <Route path="/stir-shaken">
        {() => <ProtectedRoute component={StirShakenPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/call-recordings">
        {() => <ProtectedRoute component={CallRecordingsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/portal/:token">
        {(params) => <PortalViewPage />}
      </Route>
      <Route path="/self-heal">
        {() => <ProtectedRoute component={SelfHealPage} requiredRoles={['admin', 'management']} />}
      </Route>
      <Route path="/sidebar-settings">
        {() => <ProtectedRoute component={SidebarSettingsPage} requiredRoles={['admin']} />}
      </Route>

      <Route path="/company/list">
        {() => <ProtectedRoute component={CompanyListPage} requiredRoles={['admin','management']} mgmtFeature="clients" />}
      </Route>
      <Route path="/company/create">
        {() => <ProtectedRoute component={CompanyCreatePage} requiredRoles={['admin','management']} mgmtFeature="clients" />}
      </Route>
      <Route path="/company/edit/:id">
        {() => <ProtectedRoute component={CompanyCreatePage} requiredRoles={['admin','management']} mgmtFeature="clients" />}
      </Route>
      <Route path="/client/wizard">
        {() => <ProtectedRoute component={ClientWizardPage} requiredRoles={['admin','management']} mgmtFeature="account_management" />}
      </Route>
      <Route path="/client-wizard">
        {() => <ProtectedRoute component={ClientWizardPage} requiredRoles={['admin','management']} mgmtFeature="account_management" />}
      </Route>
      <Route path="/client/config">
        {() => <ProtectedRoute component={ClientConfigPage} requiredRoles={['admin','management']} mgmtFeature="account_management" />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <GlobalErrorBoundary>
      <ThemeProvider>
        <TimezoneProvider>
          <QueryClientProvider client={queryClient}>
            <OrgScopeProvider>
              <TooltipProvider>
                <Toaster />
                <Router />
              </TooltipProvider>
            </OrgScopeProvider>
          </QueryClientProvider>
        </TimezoneProvider>
      </ThemeProvider>
    </GlobalErrorBoundary>
  );
}

export default App;
