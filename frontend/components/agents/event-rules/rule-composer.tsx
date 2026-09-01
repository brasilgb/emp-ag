"use client";

import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PermissionGate } from "@/components/auth/permission-gate";
import { useAgentJobs } from "@/hooks/agents/use-agent-jobs";
import { useEventCatalog } from "@/hooks/agents/use-agent-events";
import { useCreateEventRule } from "@/hooks/agents/use-event-rules";
import { filterOperatorLabel } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import type { EventFilters, FilterOperator } from "@/types/agents";

interface FilterRow {
  field: string;
  operator: FilterOperator;
  value: string;
}

/**
 * Correio.md v1.4 seção 23/24 — composer de Event Rule: nome, evento
 * (vindo do catálogo, seção 24 — nunca texto livre), Job, filtros
 * construídos por UI estruturada (campo + operador + valor, seção 23 —
 * nunca um editor de JSON livre como entrada principal), enabled.
 */
export function RuleComposer() {
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [rows, setRows] = useState<FilterRow[]>([]);

  const { data: catalog } = useEventCatalog();
  const { data: jobs } = useAgentJobs({ limit: 100 });
  const createRule = useCreateEventRule();

  const selectedEvent = catalog?.data.find((entry) => entry.type === eventType);
  const filterableFields = selectedEvent ? Object.entries(selectedEvent.filterableFields) : [];

  const filters: EventFilters = useMemo(() => {
    const result: EventFilters = {};

    for (const row of rows) {
      if (!row.field || row.value === "") continue;

      const fieldType = selectedEvent?.filterableFields[row.field];
      const rawValue: string | number | boolean =
        fieldType === "number" ? Number(row.value) : fieldType === "boolean" ? row.value === "true" : row.value;

      if (row.operator === "in" || row.operator === "not_in") {
        const values = row.value.split(",").map((entry) => entry.trim());
        result[row.field] = { [row.operator]: fieldType === "number" ? values.map(Number) : values };
      } else if (row.operator === "exists") {
        result[row.field] = { exists: row.value === "true" };
      } else {
        result[row.field] = { [row.operator]: rawValue };
      }
    }

    return result;
  }, [rows, selectedEvent]);

  function addRow() {
    if (filterableFields.length === 0) return;
    setRows((current) => [...current, { field: filterableFields[0][0], operator: "eq", value: "" }]);
  }

  function updateRow(index: number, patch: Partial<FilterRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !eventType || !jobId) return;

    try {
      await createRule.mutateAsync({ name: name.trim(), eventType, jobId: Number(jobId), filters, enabled: true });
      toast.success("Event Rule criada.");
      setName("");
      setEventType("");
      setJobId("");
      setRows([]);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar Event Rule."));
    }
  }

  return (
    <PermissionGate permission="agents.event_rules.create">
      <Card>
        <CardHeader>
          <p className="text-sm font-medium">Nova Event Rule</p>
          <p className="text-xs text-muted-foreground">
            Associa um tipo de evento a um Job. Quando um evento desse tipo satisfizer os filtros abaixo, o Job dispara
            automaticamente via runAgentJob — nunca com permissões diferentes das de quem criou o Job.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Lead prioritário criado" />
            </div>

            <div className="space-y-1.5">
              <Label>Job</Label>
              <Select value={jobId} onValueChange={(value) => setJobId(value ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione um Job" />
                </SelectTrigger>
                <SelectContent>
                  {(jobs?.data ?? []).map((job) => (
                    <SelectItem key={job.id} value={String(job.id)}>
                      {job.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Tipo de evento</Label>
              <Select
                value={eventType}
                onValueChange={(value) => {
                  setEventType(value ?? "");
                  setRows([]);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione um tipo de evento do catálogo" />
                </SelectTrigger>
                <SelectContent>
                  {(catalog?.data ?? []).map((entry) => (
                    <SelectItem key={entry.type} value={entry.type}>
                      {entry.type} — {entry.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedEvent ? (
              <div className="space-y-2 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Filtros</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addRow} disabled={filterableFields.length === 0}>
                    + Adicionar filtro
                  </Button>
                </div>

                {rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem filtros: a regra casa com todo evento deste tipo.</p>
                ) : (
                  <div className="space-y-2">
                    {rows.map((row, index) => (
                      <div key={index} className="flex flex-wrap items-center gap-2">
                        <Select value={row.field} onValueChange={(value) => updateRow(index, { field: value ?? "" })}>
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {filterableFields.map(([field]) => (
                              <SelectItem key={field} value={field}>
                                {field}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={row.operator}
                          onValueChange={(value) => updateRow(index, { operator: (value ?? "eq") as FilterOperator })}
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(selectedEvent.operators ?? []).map((operator) => (
                              <SelectItem key={operator} value={operator}>
                                {filterOperatorLabel(operator)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Input
                          value={row.value}
                          onChange={(event) => updateRow(index, { value: event.target.value })}
                          placeholder={row.operator === "in" || row.operator === "not_in" ? "valor1, valor2" : "valor"}
                          className="w-40"
                        />

                        <Button type="button" size="sm" variant="outline" onClick={() => removeRow(index)}>
                          Remover
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Preview (somente leitura)</p>
                  <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(filters, null, 2)}</pre>
                </div>
              </div>
            ) : null}

            <div className="sm:col-span-2">
              <Button type="submit" disabled={createRule.isPending || !name.trim() || !eventType || !jobId}>
                Criar Event Rule
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PermissionGate>
  );
}
