"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useAgentSettings, useDeleteSetting, useSetSetting } from "@/hooks/agents/use-operations";
import { SETTING_GROUPS } from "@/lib/agents/derived";
import type { SettingKey } from "@/types/agents";

import { SettingRow } from "./setting-row";

// Agentes v1.7 (correio.md "Frontend"): /agents/settings — agrupado por
// domínio, nunca um formulário genérico de key/value.
export function SettingsList() {
  const { data, isLoading, isError, refetch } = useAgentSettings();
  const setSetting = useSetSetting();
  const deleteSetting = useDeleteSetting();

  if (isLoading) return <LoadingState label="Carregando configurações..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const byKey = new Map(data.data.map((setting) => [setting.key, setting]));

  return (
    <div className="space-y-4">
      {SETTING_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">{group.title}</h3>
          </CardHeader>
          <CardContent>
            {group.keys.map((key: SettingKey) => {
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
      ))}
    </div>
  );
}
