import { SidebarContent } from "./SidebarContent";

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 hidden md:flex flex-col bg-sidebar border-r border-sidebar-border">
      <SidebarContent className="flex-1" />
    </aside>
  );
}
