import type { Client, ClientStatus, ClientType, Contact, Paginated } from "@/types/crm";

import { apiFetch, toQueryString } from "./http";

export interface ListClientsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: ClientStatus;
  type?: ClientType;
}

export interface ClientInput {
  type: ClientType;
  name: string;
  legalName?: string;
  document?: string;
  email?: string;
  phone?: string;
  website?: string;
  status?: ClientStatus;
  notes?: string;
}

export interface ContactInput {
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  isPrimary?: boolean;
  notes?: string;
}

export function listClients(params: ListClientsParams = {}): Promise<Paginated<Client>> {
  return apiFetch(`/api/crm/clients${toQueryString({ ...params })}`);
}

export function getClient(id: number): Promise<{ data: Client }> {
  return apiFetch(`/api/crm/clients/${id}`);
}

export function createClient(input: ClientInput): Promise<{ data: Client }> {
  return apiFetch("/api/crm/clients", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateClient(id: number, input: Partial<ClientInput>): Promise<{ data: Client }> {
  return apiFetch(`/api/crm/clients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function listClientContacts(clientId: number): Promise<{ data: Contact[] }> {
  return apiFetch(`/api/crm/clients/${clientId}/contacts`);
}

export function createClientContact(clientId: number, input: ContactInput): Promise<{ data: Contact }> {
  return apiFetch(`/api/crm/clients/${clientId}/contacts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateContact(id: number, input: Partial<ContactInput>): Promise<{ data: Contact }> {
  return apiFetch(`/api/crm/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
