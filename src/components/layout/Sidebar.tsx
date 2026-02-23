import { SidebarContent } from "./SidebarContent";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 hidden h-screen md:flex shrink-0 flex-col overflow-hidden bg-sidebar border-r border-sidebar-border",
        "w-[var(--sidebar-width)]",
        "transition-[width] duration-200 ease-in-out motion-reduce:transition-none",
      )}
      aria-expanded={!collapsed}
    >
      <SidebarContent
        className="flex-1"
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
      />
    </aside>
  );
}
