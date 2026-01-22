import { LayoutDashboard, Upload, FileText, ClipboardList, Settings, LogOut, Shield } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, step: null },
  { title: "Upload", url: "/upload", icon: Upload, step: "1" },
  { title: "Transactions", url: "/transactions", icon: FileText, step: "2" },
  { title: "Reports", url: "/reports", icon: ClipboardList, step: "3" },
  { title: "Settings", url: "/settings", icon: Settings, step: null },
];

export function AppSidebar() {
  const { signOut, user, role } = useAuth();

  return (
    <Sidebar className="border-r">
      <SidebarContent>
        <SidebarGroup>
          <div className="flex items-center gap-3 px-3 py-4 mb-2">
            <div className="p-2 bg-sidebar-primary rounded-lg">
              <Shield className="h-5 w-5 text-sidebar-primary-foreground" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">Audit Monitor</span>
              <span className="text-xs text-sidebar-foreground/70 capitalize">{role}</span>
            </div>
          </div>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      {item.step && (
                        <span className="flex items-center justify-center h-5 w-5 rounded-full bg-sidebar-accent text-[10px] font-bold text-sidebar-foreground/80">
                          {item.step}
                        </span>
                      )}
                      {!item.step && <item.icon className="h-4 w-4" />}
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <div className="text-xs text-sidebar-foreground/70 mb-2 truncate">
          {user?.email}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}