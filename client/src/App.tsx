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
import ApiKeysPage from "@/pages/api-keys";
import TestCallPage from "@/pages/test-call";
import LcrAnalyserPage from "@/pages/lcr-analyser";
import CallFlowSimulatorPage from "@/pages/call-flow-simulator";
import VendorSlaScorecardPage from "@/pages/vendor-sla-scorecard";
import CostOptimisationPage from "@/pages/cost-optimisation";
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
import RateCardsPage from "@/pages/rate-cards";
import AnalyticsPage from "@/pages/analytics";
import NotFound from "@/pages/not-found";

// Pages accessible to each role
const ROLE_PATHS: Record<Role, string[]> = {
  admin:      ['/', '/calls', '/alerts', '/reports', '/settings', '/team'],
  management: ['/', '/calls', '/alerts', '/reports'],
  viewer:     ['/', '/calls'],
};

function ProtectedRoute({
  component: Component,
  requiredRoles,
  viewerAssignment,
}: {
  component: React.ComponentType<any>;
  requiredRoles?: Role[];
  viewerAssignment?: string;
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

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading || (needsAssignmentCheck && assignmentsLoading)) {
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
        {() => <ProtectedRoute component={AlertsPage} requiredRoles={['admin','management']} viewerAssignment="alerts" />}
      </Route>
      <Route path="/reports">
        {() => <ProtectedRoute component={ReportsPage} requiredRoles={['admin','management']} viewerAssignment="reports" />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={SettingsPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/clients">
        {() => <ProtectedRoute component={ClientsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/fraud">
        {() => <ProtectedRoute component={FraudPage} requiredRoles={['admin','management']} viewerAssignment="fraud_fas" />}
      </Route>
      <Route path="/cdrs">
        {() => <ProtectedRoute component={CDRsPage} requiredRoles={['admin','management']} viewerAssignment="cdr_viewer" />}
      </Route>
      <Route path="/tools">
        {() => <ProtectedRoute component={ToolsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/team">
        {() => <ProtectedRoute component={TeamPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/traffic-map">
        {() => <ProtectedRoute component={TrafficMapPage} requiredRoles={['admin','management']} viewerAssignment="traffic_map" />}
      </Route>
      <Route path="/balance">
        {() => <ProtectedRoute component={BalanceMonitorPage} requiredRoles={['admin','management']} viewerAssignment="balance_monitor" />}
      </Route>
      <Route path="/dids">
        {() => <ProtectedRoute component={DIDsPage} requiredRoles={['admin','management']} viewerAssignment="did_management" />}
      </Route>
      <Route path="/server-monitoring">
        {() => <ProtectedRoute component={ServerMonitoringPage} requiredRoles={['admin','management']} viewerAssignment="server_monitoring" />}
      </Route>
      <Route path="/graphs">
        {() => <ProtectedRoute component={GraphsPage} requiredRoles={['admin','management']} viewerAssignment="graphs" />}
      </Route>
      <Route path="/bitseye">
        {() => <ProtectedRoute component={BitsEyePage} requiredRoles={['admin','management']} viewerAssignment="bitseye" />}
      </Route>
      <Route path="/account">
        {() => <ProtectedRoute component={AccountPage} requiredRoles={['admin','management','viewer']} />}
      </Route>
      <Route path="/rate-cards">
        {() => <ProtectedRoute component={RateCardsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/analytics">
        {() => <ProtectedRoute component={AnalyticsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/api-keys">
        {() => <ProtectedRoute component={ApiKeysPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/test-call">
        {() => <ProtectedRoute component={TestCallPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/lcr-analyser">
        {() => <ProtectedRoute component={LcrAnalyserPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/call-flow-simulator">
        {() => <ProtectedRoute component={CallFlowSimulatorPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/vendor-sla-scorecard">
        {() => <ProtectedRoute component={VendorSlaScorecardPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/cost-optimisation">
        {() => <ProtectedRoute component={CostOptimisationPage} requiredRoles={['admin','management']} />}
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
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </QueryClientProvider>
        </TimezoneProvider>
      </ThemeProvider>
    </GlobalErrorBoundary>
  );
}

export default App;
