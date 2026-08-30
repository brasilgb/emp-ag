"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type ClientInput,
  type ContactInput,
  type ListClientsParams,
  createClient,
  createClientContact,
  getClient,
  listClientContacts,
  listClients,
  updateClient,
  updateContact,
} from "@/services/clients";

export function useClients(params: ListClientsParams = {}) {
  return useQuery({
    queryKey: queryKeys.crm.clients(params),
    queryFn: () => listClients(params),
    placeholderData: keepPreviousData,
  });
}

export function useClient(id: number) {
  return useQuery({
    queryKey: queryKeys.crm.client(id),
    queryFn: () => getClient(id),
    enabled: Number.isFinite(id),
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ClientInput) => createClient(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "clients"] });
    },
  });
}

export function useUpdateClient(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<ClientInput>) => updateClient(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "clients"] });
    },
  });
}

export function useClientContacts(clientId: number) {
  return useQuery({
    queryKey: queryKeys.crm.clientContacts(clientId),
    queryFn: () => listClientContacts(clientId),
    enabled: Number.isFinite(clientId),
  });
}

export function useCreateClientContact(clientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ContactInput) => createClientContact(clientId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.clientContacts(clientId) });
    },
  });
}

export function useUpdateContact(clientId: number, contactId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<ContactInput>) => updateContact(contactId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.clientContacts(clientId) });
    },
  });
}
