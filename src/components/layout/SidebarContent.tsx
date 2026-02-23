import { useEffect } from "react";
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
  PanelLeftClose,
  PanelRight,
  Store,
  AlertCircle,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { ThemeToggle } from "@/components/shared";
import { toastError } from "@/lib/toast-helpers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const navigation = [
  { name: "Dashboard", href: "/app", icon: LayoutDashboard },
  { name: "Agendamentos", href: "/app/agendamentos", icon: Calendar },
  { name: "Barbeiros", href: "/app/barbeiros", icon: Scissors },
  { name: "Serviços", href: "/app/servicos", icon: Package },
  { name: "Clientes", href: "/app/clientes", icon: Users },
  { name: "Fidelidade", href: "/app/fidelidade", icon: Trophy, pro: true },
  { name: "Relatórios", href: "/app/relatorios", icon: BarChart3 },
];

const bottomNavigation = [
  { name: "Integrações", href: "/app/integracoes", icon: Key },
  { name: "Configurações", href: "/app/configuracoes", icon: Settings },
];

interface SidebarContentProps {
  /** Callback when a nav link is clicked (e.g. close mobile drawer) */
  onNavigate?: () => void;
  /** Desktop: sidebar is folded (icon-only). Omitted on mobile sheet. */
  collapsed?: boolean;
  /** Callback to fold/unfold the sidebar (desktop only). */
  onToggleCollapse?: () => void;
  className?: string;
}

export function SidebarContent({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  className,
}: SidebarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, logout, switchBarbershop, switchingBarbershop, switchError, clearSwitchError } = useAuth();
  const barbershops = profile?.barbershops ?? [];
  const hasMultipleBarbershops = barbershops.length > 1;

  useEffect(() => {
    if (switchError) toastError("Falha ao trocar de unidade", undefined, switchError);
  }, [switchError]);

  const handleSwitchBarbershop = async (id: string) => {
    try {
      await switchBarbershop(id);
    } catch {
      // Error already stored in context and toasted in useEffect
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const linkProps = (href: string) => ({
    to: href,
    onClick: onNavigate,
  });

  const isIconOnly = collapsed && onToggleCollapse != null;

  return (
    <div className={cn("flex h-full flex-col bg-sidebar", className)}>
      <div
        className={cn(
          "flex border-b border-sidebar-border",
          isIconOnly
            ? "flex-col items-center gap-2 py-4 px-2"
            : "items-center gap-3 px-6 py-5",
        )}
      >
        <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
          <img
            src="/logo-app.svg"
            alt="NavalhIA"
            className="w-full h-full object-contain"
          />
        </div>
        {!isIconOnly && (
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-sidebar-foreground">
              NavalhIA
            </h1>
          </div>
        )}
        {onToggleCollapse && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="flex-shrink-0 h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? (
              <PanelRight className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </Button>
        )}
      </div>

      {hasMultipleBarbershops && !isIconOnly && (
        <div className="px-3 pb-2 space-y-2">
          <Select
            value={profile?.barbershop_id ?? ""}
            onValueChange={handleSwitchBarbershop}
            disabled={switchingBarbershop}
          >
            <SelectTrigger className="h-9 text-sidebar-foreground border-sidebar-border bg-sidebar-accent/50">
              <Store className="h-4 w-4 shrink-0 opacity-70" />
              <SelectValue placeholder={switchingBarbershop ? "Trocando..." : "Unidade"} />
            </SelectTrigger>
            <SelectContent>
              {barbershops.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name || "Unidade"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {switchError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive space-y-2">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {switchError}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    clearSwitchError();
                    window.location.reload();
                  }}
                >
                  Recarregar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    clearSwitchError();
                    logout();
                    navigate("/login", { replace: true });
                    onNavigate?.();
                  }}
                >
                  Fazer login novamente
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <nav
        className={cn(
          "flex-1 overflow-y-auto scrollbar-thin space-y-1",
          isIconOnly ? "px-2 py-4" : "px-3 py-4",
        )}
      >
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              {...linkProps(item.href)}
              className={cn(
                "sidebar-item",
                isActive && "active",
                isIconOnly && "justify-center px-2",
              )}
              title={isIconOnly ? item.name : undefined}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!isIconOnly && (
                <>
                  <span>{item.name}</span>
                  {"pro" in item && item.pro && (
                    <span className="ml-auto rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      Pro
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      <div
        className={cn(
          "border-t border-sidebar-border space-y-1",
          isIconOnly ? "px-2 py-4" : "px-3 py-4",
        )}
      >
        {bottomNavigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              {...linkProps(item.href)}
              className={cn(
                "sidebar-item",
                isActive && "active",
                isIconOnly && "justify-center px-2",
              )}
              title={isIconOnly ? item.name : undefined}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!isIconOnly && (
                <>
                  <span>{item.name}</span>
                  {"pro" in item && item.pro && (
                    <span className="ml-auto rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      Pro
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => {
            handleLogout();
            onNavigate?.();
          }}
          className={cn(
            "sidebar-item w-full text-destructive hover:text-destructive hover:bg-destructive/10",
            isIconOnly && "justify-center px-2",
          )}
          title={isIconOnly ? "Sair" : undefined}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!isIconOnly && <span>Sair</span>}
        </button>
      </div>

      <div
        className={cn(
          "border-t border-sidebar-border space-y-3",
          isIconOnly ? "px-2 py-4" : "px-4 py-4",
        )}
      >
        {isIconOnly ? (
          <div className="flex justify-center">
            <ThemeToggle />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-sidebar-foreground/60">Tema</span>
              <ThemeToggle />
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
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
          </>
        )}
      </div>
    </div>
  );
}
