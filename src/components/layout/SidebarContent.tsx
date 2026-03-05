import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  HelpCircle,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { CheckoutModal } from "@/components/CheckoutModal";
import { isEssential } from "@/lib/plan";
import { ThemeToggle, ConfirmDialog } from "@/components/shared";
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
  { name: "Atendimento", href: "/app/whatsapp-interno", icon: MessageCircle },
  { name: "Fidelidade", href: "/app/fidelidade", icon: Trophy, pro: true },
  { name: "Relatórios", href: "/app/relatorios", icon: BarChart3 },
];

const bottomNavigation = [
  { name: "Integrações", href: "/app/integracoes", icon: Key },
  { name: "Configurações", href: "/app/configuracoes", icon: Settings },
  { name: "Ajuda", href: "/app/ajuda/whatsapp", icon: HelpCircle },
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
  const queryClient = useQueryClient();
  const {
    profile,
    logout,
    switchBarbershop,
    setSelectedScope,
    switchingBarbershop,
    switchError,
    clearSwitchError,
    selectedScope,
  } = useAuth();
  const barbershops = profile?.barbershops ?? [];
  const hasMultipleBarbershops = barbershops.length > 1;
  const showBarbershopSelector = barbershops.length >= 1;
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const planLabel =
    profile?.billing_plan === "premium"
      ? "Premium"
      : profile?.billing_plan === "pro"
        ? "Profissional"
        : "Essencial";

  useEffect(() => {
    if (switchError)
      toastError("Falha ao trocar de unidade", undefined, switchError);
  }, [switchError]);

  const handleSwitchBarbershop = async (id: string) => {
    try {
      if (id === "__all__") {
        setSelectedScope("__all__");
      } else {
        await switchBarbershop(id);
      }
      queryClient.invalidateQueries();
    } catch {
      // Error already stored in context and toasted in useEffect
    }
  };

  const barbershopSelectValue = selectedScope === "__all__" ? "__all__" : (profile?.barbershop_id ?? "");
  const barbershopSelectLabel = selectedScope === "__all__"
    ? "Todas as filiais"
    : (barbershops.find((b) => b.id === profile?.barbershop_id)?.name || "Unidade");

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
    <>
      <div className={cn("flex h-full flex-col bg-sidebar", className)}>
        <div
          className={cn(
            "flex border-b border-sidebar-border",
            isIconOnly
              ? "flex-col items-center gap-2 py-3 px-2"
              : "items-center gap-3 px-6 py-4",
          )}
        >
          <div className="w-12 h-12 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
            <img
              src="/logo-app.svg"
              alt="NavalhIA"
              className="w-full h-full object-contain"
            />
          </div>
          {!isIconOnly && (
            <div className="flex-1 min-w-0 flex flex-col">
              <h1 className="text-lg font-bold text-sidebar-foreground">
                NavalhIA
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCheckoutOpen(true)}
                  className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 focus:ring-offset-sidebar rounded-md"
                  aria-label="Ver plano e upgrade"
                >
                  <Badge
                    variant="secondary"
                    className="text-xs cursor-pointer hover:bg-sidebar-accent transition-colors"
                  >
                    {planLabel}
                  </Badge>
                </button>
                {isEssential(profile) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setCheckoutOpen(true)}
                  >
                    Upgrade
                  </Button>
                )}
              </div>
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

        {showBarbershopSelector && !isIconOnly && (
          <div className="px-3 py-4">
            <Select
              value={barbershopSelectValue}
              onValueChange={handleSwitchBarbershop}
              disabled={switchingBarbershop}
            >
              <SelectTrigger className="h-9 text-sidebar-foreground border-sidebar-border bg-sidebar-accent/50 font-bold">
                <Store className="h-4 w-4 shrink-0 opacity-70" />
                <SelectValue
                  placeholder={switchingBarbershop ? "Trocando..." : "Unidade"}
                >
                  {barbershopSelectLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  Todas as filiais
                </SelectItem>
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
                data-tour={
                  item.href.replace("/app", "").replace("/", "") || "dashboard"
                }
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
                data-tour={item.href.replace("/app", "").replace("/", "")}
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
              setLogoutConfirmOpen(true);
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
      <CheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        initialPlan="pro"
      />
      <ConfirmDialog
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        title="Sair da conta"
        description="Tem certeza que deseja sair? Você precisará fazer login novamente para acessar o painel."
        confirmLabel="Sair"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={handleLogout}
      />
    </>
  );
}
