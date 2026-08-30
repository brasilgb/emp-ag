// Reexportados por compatibilidade — definição real em "./shared", usada
// por outros módulos (ex.: types/projects.ts) sem depender de um arquivo com
// nome de módulo específico do CRM.
export type { Paginated, PaginationMeta } from "./shared";

export type ClientType = "person" | "company";
export type ClientStatus = "active" | "inactive";

export interface Client {
  id: number;
  type: ClientType;
  name: string;
  legalName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: ClientStatus;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: number;
  clientId: number;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const LEAD_SOURCES = [
  "website",
  "google_ads",
  "meta_ads",
  "instagram",
  "facebook",
  "whatsapp",
  "referral",
  "outbound",
  "organic",
  "other",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadStatus = "open" | "won" | "lost";

export interface PipelineStage {
  id: number;
  name: string;
  slug: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Lead {
  id: number;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  status: LeadStatus;
  pipelineStageId: number;
  ownerUserId: number | null;
  // Vem do backend como string (coluna numeric) para preservar precisão.
  estimatedValue: string | null;
  probability: number;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  notes: string | null;
  convertedClientId: number | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadListItem extends Lead {
  stageName: string;
  stageSlug: string;
  ownerName: string | null;
}

export interface PipelineStageLead {
  id: number;
  name: string;
  companyName: string | null;
  source: LeadSource;
  status: LeadStatus;
  pipelineStageId: number;
  estimatedValue: string | null;
  probability: number;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  createdAt: string;
}

export interface PipelineStageWithLeads extends PipelineStage {
  leads: PipelineStageLead[];
}

export const CRM_ACTIVITY_TYPES = [
  "note",
  "call",
  "email",
  "meeting",
  "whatsapp",
  "follow_up",
  "status_change",
  "conversion",
  "system",
] as const;

export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

export interface CrmActivity {
  id: number;
  leadId: number | null;
  clientId: number | null;
  userId: number | null;
  userName: string | null;
  type: CrmActivityType;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
  createdAt: string;
}

export interface ConvertLeadResult {
  lead: Lead;
  client: Client;
  contact: Contact | null;
}
