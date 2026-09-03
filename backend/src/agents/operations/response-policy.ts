import type { OperationalIncident, OperationalResponse } from './health-types.js';

export interface ResponseDecision {
  response: OperationalResponse;
  reason: string;
}

/**
 * Agentes v2.5 (correio.md seção 8) — Response Policy: mapeamento
 * determinístico incident type (+ contexto real já lido do banco) →
 * resposta. NUNCA decidido por LLM (seção 2/34) — uma tabela de decisão
 * pura, testável exaustivamente sem mock nenhum.
 *
 * `jobAutonomyEnabled` (só relevante para `repeated_job_failure`) —
 * lido pelo caller ANTES de chamar esta função (nunca uma segunda
 * consulta escondida aqui; esta função é síncrona e pura de propósito).
 */
export function evaluateResponsePolicy(incident: OperationalIncident, context: { jobAutonomyEnabled?: boolean } = {}): ResponseDecision {
  switch (incident.type) {
    case 'recovery_required':
      // Seção 10: Safe Recovery é sempre a resposta para um workflow
      // stale já coberto pelo Recovery v2.4 — não há ambiguidade a
      // avaliar (o v2.4 já decide sozinho reverted/manual_attention/skipped).
      return { response: 'safe_recovery', reason: 'Workflow stale recuperável pelo mecanismo oficial (Recovery v2.4).' };

    case 'repeated_job_failure':
      if (incident.severity !== 'critical') {
        return { response: 'observe', reason: 'Falhas abaixo do threshold do Circuit Breaker — monitorar.' };
      }
      // Seção 11: condição objetiva e perigosa (mesmo threshold do
      // Circuit Breaker real) → reduzir autonomia. Mas se a autonomia
      // JÁ estava restrita e as falhas continuam mesmo assim, reduzir de
      // novo não ajudaria — o problema não é de autonomia autônoma, é
      // mais profundo (seção 13 do correio.md v2.4: "não tentar
      // adivinhar") → escalar.
      if (context.jobAutonomyEnabled === false) {
        return {
          response: 'manual_attention',
          reason: 'Job já está com autonomia restrita e as falhas continuam — restringir de novo não resolveria; requer investigação humana.',
        };
      }
      return { response: 'restrict_autonomy', reason: 'Falhas repetidas atingiram o threshold do Circuit Breaker — reduzir autonomia por segurança.' };

    case 'run_stuck':
      // Nenhum mecanismo comprovadamente seguro de "destravar" um Run
      // preso existe nesta versão (Recovery v2.4 cobre Initiative/
      // Executive Review/Strategic Memory, nunca Job Runs) — nunca
      // inventar um aqui (seção 10: "o Supervisor NÃO deve implementar
      // reconciliação própria").
      return { response: 'observe', reason: 'Nenhum mecanismo de recovery seguro para Job Runs presos nesta versão — monitorar.' };

    case 'delivery_failure':
      return { response: 'observe', reason: 'Falha de delivery de evento — informativo, sem ação automática segura definida nesta versão.' };

    case 'autonomy_circuit_open':
      // O próprio Circuit Breaker JÁ restringiu a autonomia daquele Job
      // (é exatamente o que "circuito aberto" significa) — restringir de
      // novo seria redundante.
      return { response: 'already_handled', reason: 'Circuit Breaker já abriu e já restringe a autonomia deste Job — nenhuma ação adicional necessária.' };

    case 'approval_bottleneck':
      // Seção 3: aprovação pendente nunca é auto-aprovada nem cancelada
      // pelo supervisor — só observabilidade.
      return { response: 'observe', reason: 'Backlog de approvals pendentes — nunca aprovado/rejeitado automaticamente.' };

    case 'manual_attention_required':
      // Já é um Decision Item real e aberto na Director Decision Queue
      // (é a própria fonte do sinal) — já está sendo tratado pelo
      // mecanismo oficial.
      return { response: 'already_handled', reason: 'Já existe um item aberto na Director Decision Queue para esta condição.' };

    case 'operational_degradation':
      // Autonomia global só é desabilitada por uma ação humana explícita
      // (PATCH /agents/autonomy) — o supervisor nunca reverte isso
      // (seria "aumentar autonomia", proibido pela seção 11).
      return { response: 'observe', reason: 'Autonomia global desabilitada por decisão humana explícita — supervisor nunca reativa sozinho.' };

    default: {
      const exhaustive: never = incident.type;
      return { response: 'observe', reason: `Tipo de incidente desconhecido: ${exhaustive}` };
    }
  }
}
