import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Activity, ArrowRightLeft, Binary, Bot, ChartNoAxesCombined, FileSearch, FileText, FlaskConical, LayoutDashboard, LogOut, Microscope, Radar, Settings2 } from "lucide-react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const menuItems = [
  { icon: LayoutDashboard, label: "Visão geral", path: "/" },
  { icon: ChartNoAxesCombined, label: "Posições", path: "/positions" },
  { icon: FileText, label: "Ordens", path: "/orders" },
  { icon: Radar, label: "Radar", path: "/scanner" },
  { icon: ArrowRightLeft, label: "Arbitragem", path: "/arb" },
  { icon: FlaskConical, label: "Paper Trading", path: "/paper" },
  { icon: Microscope, label: "Experimentos IA", path: "/experiment" },
  { icon: Bot, label: "Análise IA", path: "/ai" },
  { icon: FileSearch, label: "Logs", path: "/logs" },
  { icon: Activity, label: "Eventos", path: "/audit" },
  { icon: Settings2, label: "Configuração", path: "/config" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  const [location, setLocation] = useLocation();

  if (loading || !user) return <DashboardLayoutSkeleton />;

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar/95 backdrop-blur-xl">
        <SidebarHeader className="h-20 justify-center px-2">
          <div className="flex items-center gap-2.5 px-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-[#00ff88]/35 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_22px_rgba(0,255,136,.16)]"><Binary className="h-4 w-4" /></div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="text-xs font-semibold tracking-[.14em] text-foreground">MOMENTUM</p><p className="mt-0.5 text-[10px] tracking-[.18em] text-[#00ff88]/80">CONSOLE</p></div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu className="px-2 py-2">
            {menuItems.map(item => <SidebarMenuItem key={item.path}>
              <SidebarMenuButton isActive={location === item.path} onClick={() => setLocation(item.path)} tooltip={item.label} className="h-10 font-normal data-[active=true]:bg-[#00ff88]/10 data-[active=true]:text-[#00ff88] hover:bg-white/[.04]">
                <item.icon className="h-4 w-4" /><span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>)}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-white/[.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:justify-center">
                <Avatar className="h-8 w-8 border border-white/10"><AvatarFallback className="bg-[#172033] text-xs text-[#00ff88]">{user.username.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium text-foreground">{user.username}</p><p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{user.role === "admin" ? "Administrador" : "Operador"}</p></div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44"><DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" />Sair</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center border-b border-white/[.07] bg-background/85 px-4 backdrop-blur-xl lg:hidden"><SidebarTrigger><span className="sr-only">Abrir navegação</span></SidebarTrigger><span className="ml-3 text-xs font-semibold tracking-[.14em] text-foreground">MOMENTUM CONSOLE</span></header>
        <main className="min-h-screen flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
