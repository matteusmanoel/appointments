import { ReactNode, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { SidebarContent } from "./SidebarContent";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { ChangePasswordModal } from "@/components/shared";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { profile } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <ChangePasswordModal open={!!profile?.must_change_password} />
      <Sidebar />
      {isMobile && (
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 md:hidden">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Abrir menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SidebarContent onNavigate={() => setSheetOpen(false)} className="h-full" />
            </SheetContent>
          </Sheet>
          <span className="font-semibold text-foreground">BarberFlow</span>
        </header>
      )}
      <main className={cn("md:pl-64", isMobile && "flex-1")}>
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
