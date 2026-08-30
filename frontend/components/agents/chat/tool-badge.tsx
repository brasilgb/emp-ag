// Seção 42: transparência discreta de qual tool foi consultada — nunca
// detalhes internos sensíveis, só o nome do agente e o handler da tool.
export function ToolBadge({ agentName, toolHandler }: { agentName: string; toolHandler: string }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {agentName} · Consultou: <span className="font-mono">{toolHandler}</span>
    </p>
  );
}
