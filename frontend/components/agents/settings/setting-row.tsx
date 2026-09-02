"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/auth/permission-gate";
import { isCriticalSetting, settingLabel, settingSourceLabel } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import type { ResolvedSetting } from "@/types/agents";

const SOURCE_STYLES: Record<ResolvedSetting["source"], string> = {
  job: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  global: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  default: "bg-muted text-muted-foreground",
};

/**
 * Agentes v1.7 (correio.md "UI de configuração" / "Confirmações para
 * mudanças críticas") — uma linha por setting: nome, descrição, valor
 * efetivo + origem (visualmente distinguível de herdado), default, faixa
 * permitida, campo de edição e reset. Mudanças em circuit
 * breaker/autonomia exigem confirmação via Dialog (shadcn/ui) antes de
 * aplicar — nunca `window.confirm` nesta tela nova (diferente da v1.6).
 */
export function SettingRow({
  setting,
  onSave,
  onReset,
  saving,
  resetting,
}: {
  setting: ResolvedSetting;
  onSave: (value: number) => Promise<void>;
  onReset: () => Promise<void>;
  saving: boolean;
  resetting: boolean;
}) {
  const [draft, setDraft] = useState(String(setting.effectiveValue));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parsed = Number(draft);
  const isValidDraft = draft.trim() !== '' && Number.isInteger(parsed) && parsed >= setting.min && parsed <= setting.max;
  const isDirty = isValidDraft && parsed !== setting.effectiveValue;

  async function commit() {
    try {
      await onSave(parsed);
      toast.success(`${settingLabel(setting.key)} atualizado.`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao salvar configuração."));
    }
  }

  async function handleSaveClick() {
    if (!isDirty) return;

    if (isCriticalSetting(setting.key)) {
      setConfirmOpen(true);
      return;
    }

    await commit();
  }

  async function handleReset() {
    try {
      await onReset();
      toast.success(`${settingLabel(setting.key)} voltou ao valor herdado.`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao remover override."));
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{settingLabel(setting.key)}</p>
          <Badge variant="secondary" className={`border-transparent text-xs ${SOURCE_STYLES[setting.source]}`}>
            {settingSourceLabel(setting.source)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{setting.description}</p>
        <p className="text-xs text-muted-foreground">
          Default: {setting.defaultValue} · Faixa permitida: {setting.min}–{setting.max}
          {setting.configuredValue !== null ? ` · Configurado: ${setting.configuredValue}` : ""}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-24"
          min={setting.min}
          max={setting.max}
        />
        <PermissionGate permission="agents.settings.manage">
          <Button size="sm" disabled={!isDirty || saving} onClick={handleSaveClick}>
            Salvar
          </Button>
          {setting.source !== "default" ? (
            <Button size="sm" variant="outline" disabled={resetting} onClick={handleReset}>
              Herdar
            </Button>
          ) : null}
        </PermissionGate>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar mudança crítica</DialogTitle>
            <DialogDescription>
              {settingLabel(setting.key)} controla diretamente autonomia/circuit breaker. Alterar de{" "}
              <strong>{setting.effectiveValue}</strong> para <strong>{parsed}</strong> muda o comportamento real de
              todos os Jobs que herdam este valor. Confirmar?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                setConfirmOpen(false);
                await commit();
              }}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
