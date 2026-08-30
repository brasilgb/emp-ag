import {
  Bot,
  Building2,
  FolderKanban,
  HeartHandshake,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Permissão mínima para o item aparecer na sidebar (UX apenas — a rota
   * continua acessível por URL direta; quem barra de verdade é o backend).
   * Uma lista significa "qualquer uma dessas". Sem essa propriedade, o item
   * é sempre exibido.
   */
  permission?: string | string[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/crm", label: "CRM", icon: Users, permission: ["leads.read", "clients.read"] },
  { href: "/clients", label: "Clientes", icon: Building2, permission: "clients.read" },
  { href: "/leads", label: "Leads", icon: Target, permission: "leads.read" },
  { href: "/projects", label: "Projetos", icon: FolderKanban, permission: "projects.read" },
  { href: "/financial", label: "Financeiro", icon: Wallet, permission: "financial.read" },
  { href: "/support", label: "Suporte", icon: LifeBuoy, permission: "support.read" },
  { href: "/customer-success", label: "Customer Success", icon: HeartHandshake, permission: "cs.read" },
  { href: "/agents", label: "Agentes", icon: Bot, permission: "agents.read" },
  { href: "/settings", label: "Configurações", icon: Settings, permission: "users.manage" },
];
