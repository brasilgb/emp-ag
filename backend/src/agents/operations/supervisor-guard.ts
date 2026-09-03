import { runOperationalSupervision } from './supervisor-service.js';
import type { RunOperationalSupervisionOptions } from './supervisor-service.js';
import type { OperationalSupervisionReport } from './health-types.js';

/**
 * Agentes v2.5.1 (correio.md seções 9/27/28/29) — "runOperationalSupervision()
 * ou wrapper oficial correspondente deve conhecer exclusão mútua...
 * scheduler → mesmo guard, API → mesmo guard. Não criar
 * schedulerGuard/apiGuard independentes." Este módulo é ESSE guard
 * central único — `routes/agents/operations.ts` (manual) e
 * `agents/operations/scheduler.ts` (automático) chamam exclusivamente
 * `runGuardedOperationalSupervision`, nunca `runOperationalSupervision`
 * diretamente (que continua exportada e testável isoladamente, sem
 * guard, para os testes unitários da v2.5).
 *
 * Guard local em memória (`let running`) — suficiente nesta versão
 * porque a aplicação roda numa única instância (seção 10, sem réplicas
 * configuradas em `docker-compose.yml`); documentado como limitação
 * real no relatório de entrega (nunca protege contra duas instâncias de
 * backend rodando simultaneamente — precisaria de lock distribuído,
 * Redis por exemplo, se isso mudar).
 *
 * Sem `await` entre a checagem (`if (running)`) e a escrita
 * (`running = true`) — o event loop de Node é single-threaded, então não
 * existe janela de corrida entre as duas linhas (nunca precisa de
 * `SELECT`/`UPDATE` condicional aqui, ao contrário dos guards que
 * protegem múltiplos PROCESSOS/conexões distintas, como os das v2.1-v2.5).
 */
export class SupervisionAlreadyRunningError extends Error {
  constructor() {
    super('Supervisão operacional já está em execução — tente novamente em instantes.');
    this.name = 'SupervisionAlreadyRunningError';
  }
}

let running = false;

export function isOperationalSupervisionRunning(): boolean {
  return running;
}

/**
 * `runner` é injetável só para teste (mesmo padrão de `collectors?` em
 * `decisions/sync-service.ts:syncDirectorDecisionQueue`) — permite
 * provar que o guard libera corretamente mesmo quando a supervisão
 * lança exceção, sem precisar forçar uma falha real de banco/rede.
 */
export async function runGuardedOperationalSupervision(
  params: RunOperationalSupervisionOptions,
  runner: (options: RunOperationalSupervisionOptions) => Promise<OperationalSupervisionReport> = runOperationalSupervision,
): Promise<OperationalSupervisionReport> {
  if (running) {
    throw new SupervisionAlreadyRunningError();
  }

  running = true;
  try {
    return await runner(params);
  } finally {
    running = false;
  }
}
