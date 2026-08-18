import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
import { DashboardLayoutSkeleton } from "@/components/DashboardLayoutSkeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import NotFound from "@/pages/NotFound";
import AIAnalysisPage from "@/pages/AIAnalysisPage";
import ArbPage from "@/pages/ArbPage";
import ExperimentPage from "@/pages/ExperimentPage";
import AuditPage from "@/pages/AuditPage";
import ConfigPage from "@/pages/ConfigPage";
import LoginPage from "@/pages/LoginPage";
import LogsPage from "@/pages/LogsPage";
import OrdersPage from "@/pages/OrdersPage";
import OverviewPage from "@/pages/OverviewPage";
import PaperTradingPage from "@/pages/PaperTradingPage";
import ScannerPage from "@/pages/ScannerPage";
import PositionsPage from "@/pages/PositionsPage";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function ProtectedView({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <Redirect to="/login" />;
  return <DashboardLayout>{children}</DashboardLayout>;
}

function LoginView() {
  const { loading, user } = useAuth();
  if (loading) return <div className="min-h-screen bg-background" />;
  if (user) return <Redirect to="/" />;
  return <LoginPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginView} />
      <Route path="/" component={() => <ProtectedView><OverviewPage /></ProtectedView>} />
      <Route path="/positions" component={() => <ProtectedView><PositionsPage /></ProtectedView>} />
      <Route path="/orders" component={() => <ProtectedView><OrdersPage /></ProtectedView>} />
      <Route path="/scanner" component={() => <ProtectedView><ScannerPage /></ProtectedView>} />
      <Route path="/arb" component={() => <ProtectedView><ArbPage /></ProtectedView>} />
      <Route path="/paper" component={() => <ProtectedView><PaperTradingPage /></ProtectedView>} />
      <Route path="/experiment" component={() => <ProtectedView><ExperimentPage /></ProtectedView>} />
      <Route path="/ai" component={() => <ProtectedView><AIAnalysisPage /></ProtectedView>} />
      <Route path="/logs" component={() => <ProtectedView><LogsPage /></ProtectedView>} />
      <Route path="/audit" component={() => <ProtectedView><AuditPage /></ProtectedView>} />
      <Route path="/config" component={() => <ProtectedView><ConfigPage /></ProtectedView>} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
