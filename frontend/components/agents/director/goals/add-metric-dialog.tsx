"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAddGoalMetric, useGoalMetricCatalog } from "@/hooks/agents/use-director-goals";
import { toErrorMessage } from "@/services/http";

/**
 * Agentes v2.0 (correio.md seção 4) — a UI só permite escolher uma chave
 * do catálogo determinístico já existente (nunca texto livre) — o
 * mesmo princípio de "nenhuma query arbitrária" reforçado também na
 * tela, mesmo que o backend seja quem realmente barra.
 */
export function AddMetricDialog({ goalId, open, onOpenChange }: { goalId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const catalog = useGoalMetricCatalog();
  const addMetric = useAddGoalMetric();

  const [metricKey, setMetricKey] = useState<string | undefined>(undefined);
  const [targetValue, setTargetValue] = useState("");
  const [weight, setWeight] = useState("1");

  const selected = catalog.data?.data.find((entry) => entry.key === metricKey);

  async function handleAdd() {
    if (!metricKey || !targetValue) return;

    try {
      await addMetric.mutateAsync({ goalId, input: { metricKey, targetValue: Number(targetValue), weight: Number(weight) || 1 } });
      toast.success("Métrica adicionada.");
      onOpenChange(false);
      setMetricKey(undefined);
      setTargetValue("");
      setWeight("1");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao adicionar métrica."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar métrica</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="metric-key">Métrica (catálogo)</Label>
            <Select value={metricKey} onValueChange={(value) => setMetricKey(value ?? undefined)} disabled={catalog.isLoading}>
              <SelectTrigger id="metric-key" className="w-full">
                <SelectValue placeholder="Selecione uma métrica" />
              </SelectTrigger>
              <SelectContent>
                {catalog.data?.data.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected ? <p className="text-xs text-muted-foreground">{selected.description}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="metric-target">Valor alvo{selected ? ` (${selected.unit})` : ""}</Label>
              <Input id="metric-target" type="number" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="metric-weight">Peso</Label>
              <Input id="metric-weight" type="number" min={1} value={weight} onChange={(event) => setWeight(event.target.value)} />
            </div>
          </div>
          <Button className="w-full" onClick={handleAdd} disabled={!metricKey || !targetValue || addMetric.isPending}>
            Adicionar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
