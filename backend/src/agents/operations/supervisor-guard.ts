import { database } from '../../services/database.js';
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
 * v3.3 (correio.md "Distributed Operational Supervision Locking") —
 * limitação explícita da v3.2: o guard local (`let running`) só protege
 * chamadas concorrentes DENTRO do mesmo processo — nada impedia duas
 * instâncias de backend (dois containers, um deploy horizontal) de
 * rodar `runOperationalSupervision` simultaneamente, cada uma com sua
 * própria variável `running` em memória, sem nenhuma coordenação entre
 * si. Resolvido com um PostgreSQL advisory lock (`pg_try_advisory_lock`)
 * — infraestrutura já obrigatória do projeto, sem exigir Redis/migration
 * novos. O guard local É PRESERVADO como fast-path (evita o round-trip ao
 * Postgres no caso comum de uma chamada concorrente no MESMO processo),
 * nunca como fonte de verdade paralela: a decisão real de "quem executa"
 * é sempre o advisory lock — o guard local só pode ficar `true` quando
 * este processo genuinamente detém o lock, nunca antes, nunca
 * independentemente dele.
 *
 * v3.3.1 (correio.md "Fechamento do lifecycle do advisory lock") —
 * fechamento de uma lacuna deixada em aberto pela v3.3: se
 * `pg_advisory_unlock` falhar, a `PoolClient` NUNCA volta ao pool como
 * saudável (`client.release()` sem argumento) — isso devolveria ao pool
 * uma conexão que ainda pode estar segurando o lock de sessão, causando
 * um bloqueio falso e potencialmente indefinido do Operational
 * Supervisor. Em vez disso, `client.release(unlockError)` (a assinatura
 * oficial do driver `pg` para "descarte esta conexão") força o pool a
 * FECHAR a conexão de verdade — e o próprio Postgres libera todos os
 * locks de sessão pertencentes a ela como consequência direta do
 * encerramento. Ver o `finally` de `runGuardedOperationalSupervision`
 * abaixo para o mecanismo completo.
 */
export class SupervisionAlreadyRunningError extends Error {
  constructor() {
    super('Supervisão operacional já está em execução — tente novamente em instantes.');
    this.name = 'SupervisionAlreadyRunningError';
  }
}

// Chave do advisory lock (correio.md seção 3) — um bigint CONSTANTE e
// documentado, nunca aleatório/timestamp/gerado por execução: a chave É
// a identidade do lock, então precisa ser a MESMA em toda instância do
// backend, para sempre (trocá-la depois de implantada faria instâncias
// antigas e novas deixarem de se coordenar entre si durante um deploy).
// Escolhida arbitrariamente (sem significado especial) — só precisa ser
// estável. `pg_try_advisory_lock(bigint)` usa o espaço de 64 bits
// assinado do Postgres; este valor cabe com folga.
export const OPERATIONAL_SUPERVISION_LOCK_KEY = 7412583900n;

let running = false;

export function isOperationalSupervisionRunning(): boolean {
  return running;
}

// Gancho SOMENTE de teste (mesmo padrão já usado em
// `agents/llm/factory.ts`/`agents/followups/action-proposals-service.ts`/
// `agents/operations/supervisor-service.ts`), nunca referenciado fora de
// `*.test.ts`: força a PRÓXIMA tentativa de `pg_advisory_unlock` a falhar,
// para provar deterministicamente o descarte de conexão (v3.3.1) sem
// depender de uma falha real e imprevisível de infraestrutura. Autolimpa
// (volta a `false`) assim que consumido — nunca precisa ser resetado
// manualmente entre testes. `false` (default) nunca altera o
// comportamento em produção.
let forcedUnlockFailureForTests = false;

export function setForcedUnlockFailureForTests(force: boolean): void {
  forcedUnlockFailureForTests = force;
}

/**
 * `runner` é injetável só para teste (mesmo padrão de `collectors?` em
 * `decisions/sync-service.ts:syncDirectorDecisionQueue`) — permite
 * provar que o guard libera corretamente mesmo quando a supervisão lança
 * exceção, sem precisar forçar uma falha real de banco/rede.
 *
 * Lifecycle da conexão (correio.md seção 2, ponto crítico): advisory
 * locks de SESSÃO pertencem à conexão, não ao pool abstrato —
 * `database.connect()` reserva uma `PoolClient` DEDICADA só para esta
 * chamada; `pg_try_advisory_lock`/`pg_advisory_unlock` abaixo usam
 * SEMPRE essa mesma `client`, nunca `database.query(...)` (que pegaria
 * uma conexão qualquer do pool a cada chamada — quebraria a garantia).
 */
export async function runGuardedOperationalSupervision(
  params: RunOperationalSupervisionOptions,
  runner: (options: RunOperationalSupervisionOptions) => Promise<OperationalSupervisionReport> = runOperationalSupervision,
): Promise<OperationalSupervisionReport> {
  // Fast-path local: evita o round-trip ao Postgres quando ESTE processo
  // já sabe que está executando uma supervisão. Nunca a fonte de
  // verdade — só uma otimização. Duas chamadas quase simultâneas podem
  // ambas passar por aqui antes de qualquer uma setar `running = true`
  // (não há `await` nenhum ainda) — é seguro: o advisory lock abaixo
  // decide de verdade quem executa; a perdedora dessa corrida também
  // recebe `SupervisionAlreadyRunningError`, só que via `acquired === false`
  // em vez deste atalho.
  if (running) {
    throw new SupervisionAlreadyRunningError();
  }

  const client = await database.connect();

  let acquired: boolean;
  try {
    const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [OPERATIONAL_SUPERVISION_LOCK_KEY]);
    acquired = result.rows[0]?.acquired === true;
  } catch (error) {
    // correio.md seção 9 — falha de INFRAESTRUTURA ao tentar o lock
    // (Postgres indisponível, por exemplo) nunca pode ser confundida com
    // "already_running": propaga como o erro estrutural que é.
    client.release();
    throw error;
  }

  if (!acquired) {
    // Lock ocupado por outra sessão (outro processo/instância, ou outra
    // chamada concorrente deste mesmo processo que venceu a corrida do
    // fast-path acima) — estado operacional esperado, nunca um erro
    // (correio.md seção 5): mesmo contrato já existente
    // (`SupervisionAlreadyRunningError`), nunca um segundo contrato
    // paralelo de "skipped".
    client.release();
    throw new SupervisionAlreadyRunningError();
  }

  running = true;
  try {
    return await runner(params);
  } finally {
    // correio.md seção 8 — liberação obrigatória em `finally`, cobrindo
    // sucesso, falha individual (v3.2, já isolada dentro de `runner`),
    // falha estrutural, e qualquer exceção inesperada: `running=false` e
    // o `unlock` sempre rodam, nesta ordem, antes de devolver a conexão
    // ao pool. Nunca depender só da propriedade do Postgres de liberar
    // locks de sessão quando a conexão fecha — o pool REUSA conexões
    // (não fecha entre usos), então essa propriedade nunca entraria em
    // jogo no fluxo normal; ela é só uma rede de segurança adicional se
    // o processo inteiro morrer no meio.
    running = false;
    try {
      // v3.3.1 (correio.md "Fechamento do lifecycle do advisory lock") —
      // tentativa NORMAL de liberação. Se `forcedUnlockFailureForTests`
      // (gancho SOMENTE de teste, ver export acima) estiver armado, simula uma
      // falha real de `pg_advisory_unlock` sem sequer rodar a query —
      // nesse caso o lock nunca é liberado por este caminho; a única
      // forma de liberá-lo passa a ser destruir a sessão (branch do catch
      // abaixo), exatamente o mecanismo real do Postgres que esta versão
      // existe para provar.
      if (forcedUnlockFailureForTests) {
        forcedUnlockFailureForTests = false;
        throw new Error('Falha forçada para teste (v3.3.1): pg_advisory_unlock.');
      }

      await client.query('SELECT pg_advisory_unlock($1)', [OPERATIONAL_SUPERVISION_LOCK_KEY]);
      // Unlock confirmado — a sessão está limpa, devolvê-la ao pool como
      // uma conexão saudável e reutilizável é seguro e é o fluxo normal.
      client.release();
    } catch (unlockError) {
      // correio.md (rodada de fechamento) — uma falha ao LIBERAR não pode
      // ser confundida com sucesso completo, e a conexão problemática
      // NUNCA pode voltar ao pool como se estivesse saudável: se o
      // unlock não pôde ser confirmado, não há como garantir que o lock
      // de sessão foi de fato removido enquanto a conexão continuar viva
      // — a única garantia real do Postgres é que locks de SESSÃO somem
      // quando a sessão termina. Por isso `client.release(unlockError)`
      // (nunca `client.release()` sem argumento): a assinatura oficial do
      // driver `pg` (`release(err?: Error | boolean)`) trata um argumento
      // truthy como "descarte esta conexão, não a devolva ao pool" — o
      // pool então fecha a conexão de verdade, e o PRÓPRIO Postgres libera
      // todos os locks de sessão pertencentes a ela como consequência
      // direta do encerramento (documentado desde a implementação
      // original do lock, seção "release" — aqui é onde essa propriedade
      // deixa de ser só uma rede de segurança teórica e passa a ser o
      // mecanismo de recuperação ativo deste branch específico). Nunca um
      // catch silencioso (v3.2 seção 20, mesmo princípio): logada
      // explicitamente, mesmo padrão já usado pelo `.catch()` externo do
      // scheduler para erros inesperados.
      //
      // Precedência de erros: se o `try` de `runner(params)` acima já
      // lançou (falha estrutural do runner), a exceção ORIGINAL dele é a
      // que se propaga deste `finally` (comportamento nativo do
      // JavaScript — um `finally` que não lança substitui nada; só
      // lançaria por cima se ESTE catch relançasse, o que ele
      // deliberadamente NÃO faz). `unlockError` é só registrado, nunca
      // relançado — nunca mascara a causa original.
      // eslint-disable-next-line no-console
      console.error('[operational-supervision-guard] falha ao liberar o advisory lock — conexão será descartada, não devolvida ao pool:', unlockError);
      client.release(unlockError instanceof Error ? unlockError : new Error(String(unlockError)));
    }
  }
}
