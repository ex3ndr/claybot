"use client";

import {
  Activity,
  Bot,
  BookOpen,
  Clock,
  Database,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Settings,
  Sparkles,
  Wrench
} from "lucide-react";

import { NavDocuments } from "@/components/nav-documents";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from "@/components/ui/sidebar";

const data = {
  user: {
    name: "ClayBot Operator",
    email: "engine@local",
    avatar: "https://ui.shadcn.com/avatars/shadcn.jpg"
  },
  navMain: [
    {
      title: "Overview",
      url: "/",
      icon: LayoutDashboard
    },
    {
      title: "Agents",
      url: "/agents",
      icon: MessageSquare
    },
    {
      title: "Automations",
      url: "/automations",
      icon: Clock
    },
    {
      title: "Providers",
      url: "/providers",
      icon: Bot
    },
    {
      title: "Connectors",
      url: "/connectors",
      icon: Plug
    },
    {
      title: "Tools",
      url: "/tools",
      icon: Wrench
    },
    {
      title: "Telemetry",
      url: "/telemetry",
      icon: Activity
    }
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "#",
      icon: Settings
    },
    {
      title: "Docs",
      url: "#",
      icon: BookOpen
    },
    {
      title: "Playground",
      url: "#",
      icon: Sparkles
    }
  ],
  documents: [
    {
      name: "Prompt Library",
      url: "#",
      icon: Sparkles
    },
    {
      name: "Connector Index",
      url: "#",
      icon: Database
    },
    {
      name: "Runbooks",
      url: "#",
      icon: BookOpen
    }
  ]
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
              <a href="#">
                <Sparkles className="h-5 w-5" />
                <span className="text-base font-semibold">ClayBot</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavDocuments items={data.documents} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
