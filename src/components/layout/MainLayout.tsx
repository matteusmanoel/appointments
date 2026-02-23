import { CSSProperties, ReactNode, useMemo, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { SidebarContent } from "./SidebarContent";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { ChangePasswordModal } from "@/components/shared";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { profile } = useAuth();

  const layoutStyle = useMemo(
    () =>
      ({
        "--sidebar-width": sidebarCollapsed ? "4rem" : "16rem",
        "--sidebar-gap": "1rem",
      }) as CSSProperties,
    [sidebarCollapsed],
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-background md:flex-row" style={layoutStyle}>
      <ChangePasswordModal open={!!profile?.must_change_password} />
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((s) => !s)}
      />
      {/* Header mobile: full width no topo; em md fica oculto (sidebar fixa no lugar) */}
      <header className="sticky top-0 z-30 flex h-14 w-full shrink-0 items-center gap-4 border-b bg-background px-4 md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Abrir menu" className="min-h-[2.75rem] min-w-[2.75rem] touch-manipulation">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          {/* No mobile: drawer em tela cheia para não deixar "resto" de conteúdo; em md+ não usado (sidebar fixa) */}
          <SheetContent side="left" className="w-full max-w-[100vw] p-0 md:w-64 md:max-w-sm" aria-describedby="sheet-menu-desc">
            <SheetHeader className="sr-only">
              <SheetTitle>Menu de navegação</SheetTitle>
              <SheetDescription id="sheet-menu-desc">
                Navegação principal da aplicação NavalhIA
              </SheetDescription>
            </SheetHeader>
            <SidebarContent
              onNavigate={() => setSheetOpen(false)}
              className="h-full"
            />
          </SheetContent>
        </Sheet>
        <img src="/logo-app.svg" alt="NavalhIA" className="h-7 w-7 object-contain" />
        <span className="font-bold text-foreground">NavalhIA</span>
      </header>
      <main
        className={cn(
          "flex-1 min-w-0 w-full pl-0 min-h-0",
          "md:pl-[calc(var(--sidebar-width)+var(--sidebar-gap))]",
          "transition-[padding-left] duration-200 ease-in-out motion-reduce:transition-none",
        )}
      >
        <div className="w-full p-4 md:py-8 md:pr-8 md:pl-0">{children}</div>
      </main>
    </div>
  );
}
