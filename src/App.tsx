import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthError } from "@/lib/api";
import { nativeAiUiEnabled } from "@/lib/native-ai-ui";
import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider, Outlet, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { UpgradeGate } from "@/components/UpgradeGate";
import { MainLayout } from "@/components/layout/MainLayout";
import { LoadingState } from "@/components/LoadingState";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import PublicBooking from "./pages/PublicBooking";
import RescheduleOrCancel from "./pages/RescheduleOrCancel";
import NotFound from "./pages/NotFound";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Agendamentos = lazy(() => import("./pages/Agendamentos"));
const Barbeiros = lazy(() => import("./pages/Barbeiros"));
const Servicos = lazy(() => import("./pages/Servicos"));
const Clientes = lazy(() => import("./pages/Clientes"));
const Fidelidade = lazy(() => import("./pages/Fidelidade"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const Integracoes = lazy(() => import("./pages/Integracoes"));
const Relatorios = lazy(() => import("./pages/Relatorios"));
const Docs = lazy(() => import("./pages/Docs"));
const AjudaWhatsApp = lazy(() => import("./pages/AjudaWhatsApp"));
const WhatsAppInterno = lazy(() => import("./pages/WhatsAppInterno"));
const Planos = lazy(() => import("./pages/Planos"));

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

const appChildren = [
  { index: true, element: <Suspense fallback={<LoadingState fullPage />}><Dashboard /></Suspense> },
  { path: "link", element: <Navigate to="/app/configuracoes?open=booking" replace /> },
  { path: "agendamentos", element: <Suspense fallback={<LoadingState fullPage />}><Agendamentos /></Suspense> },
  { path: "barbeiros", element: <Suspense fallback={<LoadingState fullPage />}><Barbeiros /></Suspense> },
  { path: "servicos", element: <Suspense fallback={<LoadingState fullPage />}><Servicos /></Suspense> },
  { path: "clientes", element: <Suspense fallback={<LoadingState fullPage />}><Clientes /></Suspense> },
  { path: "fidelidade", element: <Suspense fallback={<LoadingState fullPage />}><UpgradeGate featureName="Fidelidade"><Fidelidade /></UpgradeGate></Suspense> },
  { path: "integracoes", element: <Suspense fallback={<LoadingState fullPage />}><Integracoes /></Suspense> },
  ...(nativeAiUiEnabled
    ? [
        {
          path: "whatsapp-interno",
          element: (
            <Suspense fallback={<LoadingState fullPage />}>
              <UpgradeGate featureName="Atendimento">
                <WhatsAppInterno />
              </UpgradeGate>
            </Suspense>
          ),
        },
      ]
    : [
        {
          path: "whatsapp-interno",
          element: <Navigate to="/app" replace />,
        },
      ]),
  { path: "configuracoes", element: <Suspense fallback={<LoadingState fullPage />}><Configuracoes /></Suspense> },
  { path: "relatorios", element: <Suspense fallback={<LoadingState fullPage />}><Relatorios /></Suspense> },
  { path: "planos", element: <Suspense fallback={<LoadingState fullPage />}><Planos /></Suspense> },
  { path: "ajuda/whatsapp", element: <Suspense fallback={<LoadingState fullPage />}><AjudaWhatsApp /></Suspense> },
] as const;

const router = createBrowserRouter(
  [
    { path: "/", element: <Landing /> },
    { path: "/login", element: <Login /> },
    { path: "/onboarding", element: <Onboarding /> },
    { path: "/docs", element: <Suspense fallback={<LoadingState fullPage />}><Docs /></Suspense> },
    { path: "/b/:slug", element: <PublicBooking /> },
    { path: "/reagendar/:token", element: <RescheduleOrCancel /> },
    { path: "/cancelar/:token", element: <RescheduleOrCancel /> },
    {
      path: "/app",
      element: <AppLayout />,
      children: [...appChildren],
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
