import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthError } from "@/lib/api";
import { createBrowserRouter, RouterProvider, Outlet, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { UpgradeGate } from "@/components/UpgradeGate";
import { MainLayout } from "@/components/layout/MainLayout";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Agendamentos from "./pages/Agendamentos";
import Barbeiros from "./pages/Barbeiros";
import Servicos from "./pages/Servicos";
import Clientes from "./pages/Clientes";
import Fidelidade from "./pages/Fidelidade";
import Configuracoes from "./pages/Configuracoes";
import Integracoes from "./pages/Integracoes";
import Relatorios from "./pages/Relatorios";
import Docs from "./pages/Docs";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import PublicBooking from "./pages/PublicBooking";
import RescheduleOrCancel from "./pages/RescheduleOrCancel";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Não retentar em 401: evita dezenas de requisições falhando no DevTools (redirect já vai para /login).
      retry: (failureCount, error) =>
        !(error instanceof AuthError),
    },
  },
});

const AppLayout = () => (
  <ProtectedRoute>
    <MainLayout>
      <Outlet />
    </MainLayout>
  </ProtectedRoute>
);

const router = createBrowserRouter(
  [
    { path: "/", element: <Landing /> },
    { path: "/login", element: <Login /> },
    { path: "/onboarding", element: <Onboarding /> },
    { path: "/docs", element: <Docs /> },
    { path: "/b/:slug", element: <PublicBooking /> },
    { path: "/reagendar/:token", element: <RescheduleOrCancel /> },
    { path: "/cancelar/:token", element: <RescheduleOrCancel /> },
    {
      path: "/app",
      element: <AppLayout />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: "link", element: <Navigate to="/app/configuracoes?open=booking" replace /> },
        { path: "agendamentos", element: <Agendamentos /> },
        { path: "barbeiros", element: <Barbeiros /> },
        { path: "servicos", element: <Servicos /> },
        { path: "clientes", element: <Clientes /> },
        { path: "fidelidade", element: <UpgradeGate featureName="Fidelidade"><Fidelidade /></UpgradeGate> },
        { path: "integracoes", element: <UpgradeGate featureName="Integrações"><Integracoes /></UpgradeGate> },
        { path: "configuracoes", element: <Configuracoes /> },
        { path: "relatorios", element: <Relatorios /> },
      ],
    },
    { path: "*", element: <NotFound /> },
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  }
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" storageKey="navalhia-theme" enableSystem>
      <AuthProvider>
        <TooltipProvider delayDuration={0}>
          <Toaster />
          <Sonner />
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
