import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Calendar,
  Users,
  Scissors,
  Package,
  UserCircle,
  Trophy,
  Settings,
  LogOut,
  Key,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { ThemeToggle } from "@/components/shared";

const navigation = [
  { name: "Dashboard", href: "/app", icon: LayoutDashboard },
  { name: "Agendamentos", href: "/app/agendamentos", icon: Calendar },
  { name: "Barbeiros", href: "/app/barbeiros", icon: Scissors },
  { name: "Serviços", href: "/app/servicos", icon: Package },
  { name: "Clientes", href: "/app/clientes", icon: Users },
  { name: "Fidelidade", href: "/app/fidelidade", icon: Trophy },
];

const bottomNavigation = [
  { name: "Integrações", href: "/app/integracoes", icon: Key },
  { name: "Configurações", href: "/app/configuracoes", icon: Settings },
];

interface SidebarContentProps {
  /** Callback when a nav link is clicked (e.g. close mobile drawer) */
  onNavigate?: () => void;
  className?: string;
}

export function SidebarContent({ onNavigate, className }: SidebarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const linkProps = (href: string) => ({
    to: href,
    onClick: onNavigate,
  });

  return (
    <div className={cn("flex h-full flex-col bg-sidebar", className)}>
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
          <Scissors className="w-5 h-5 text-sidebar-primary-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-sidebar-foreground">BarberFlow</h1>
          <p className="text-xs text-sidebar-foreground/60">Gestão de Barbearia</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              {...linkProps(item.href)}
              className={cn("sidebar-item", isActive && "active")}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-sidebar-border space-y-1">
        {bottomNavigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              {...linkProps(item.href)}
              className={cn("sidebar-item", isActive && "active")}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.name}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => {
            handleLogout();
            onNavigate?.();
          }}
          className="sidebar-item w-full text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <LogOut className="w-5 h-5" />
          <span>Sair</span>
        </button>
      </div>

      <div className="px-4 py-4 border-t border-sidebar-border space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-sidebar-foreground/60">Tema</span>
          <ThemeToggle />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center">
            <UserCircle className="w-5 h-5 text-sidebar-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {profile?.full_name ?? profile?.role ?? "Admin"}
            </p>
            <p className="text-xs text-sidebar-foreground/60 truncate">
              {profile?.email ?? "—"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
