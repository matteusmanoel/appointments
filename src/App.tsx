import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
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
import Login from "./pages/Login";
import PublicBooking from "./pages/PublicBooking";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

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
    { path: "/b/:slug", element: <PublicBooking /> },
    {
      path: "/app",
      element: <AppLayout />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: "agendamentos", element: <Agendamentos /> },
        { path: "barbeiros", element: <Barbeiros /> },
        { path: "servicos", element: <Servicos /> },
        { path: "clientes", element: <Clientes /> },
        { path: "fidelidade", element: <Fidelidade /> },
        { path: "integracoes", element: <Integracoes /> },
        { path: "configuracoes", element: <Configuracoes /> },
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
    <ThemeProvider attribute="class" defaultTheme="system" storageKey="barberflow-theme" enableSystem>
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
