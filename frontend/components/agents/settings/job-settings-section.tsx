"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useDeleteJobSetting, useJobSettings, useSetJobSetting } from "@/hooks/agents/use-operations";
import { SETTING_GROUPS } from "@/lib/agents/derived";
import type { SettingKey } from "@/types/agents";

import { SettingRow } from "./setting-row";

// Agentes v1.7 (correio.md "UI de configuração": "No detalhe do Job,
// mostrar overrides"). Mesmo componente SettingRow da tela global —
// aqui `source` distingue "job" (override deste Job) de "global"/
// "default" (herdado), nunca um estado inventado no frontend.
export function JobSettingsSection({ jobId }: { jobId: number }) {
  const { data, isLoading, isError, refetch } = useJobSettings(jobId);
  const setSetting = useSetJobSetting(jobId);
  const deleteSetting = useDeleteJobSetting(jobId);

  if (isLoading) return <LoadingState label="Carregando configurações do Job..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const byKey = new Map(data.data.map((setting) => [setting.key, setting]));

  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Configurações operacionais (overrides deste Job)</h3>
      </CardHeader>
      <CardContent>
        {SETTING_GROUPS.flatMap((group) => group.keys).map((key: SettingKey) => {
          const setting = byKey.get(key);
          if (!setting) return null;

          return (
            <SettingRow
              key={key}
              setting={setting}
              saving={setSetting.isPending}
              resetting={deleteSetting.isPending}
              onSave={async (value) => {
                await setSetting.mutateAsync({ key, value });
              }}
              onReset={async () => {
                await deleteSetting.mutateAsync(key);
              }}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
