import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DeterministicRouter } from '../router/deterministic-router.js';
import { DeterministicInterpreter } from './deterministic-interpreter.js';

/*
 * Regressão: saldo pendente (finance.get_summary) x saldo vencido
 * (finance.get_overdue_receivables/get_overdue_payables). Bug real: antes
 * desta correção, "quanto temos a receber" batia direto em
 * get_overdue_receivables só por conter a palavra "receber", sem nenhum
 * marcador de atraso — get_summary nunca era alcançável para essas
 * frases. Cobre os dois níveis (AgentRouter escolhe o departamento,
 * DeterministicInterpreter escolhe a tool), já que a correção mexeu nos
 * dois: sem 'recebimento'/'devendo' no router, mensagens como
 * "recebimentos em atraso" nem chegavam ao agente financeiro.
 */
describe('Router/Interpreter financeiro — saldo pendente x vencido', () => {
  const router = new DeterministicRouter();
  const interpreter = new DeterministicInterpreter();

  function financeTool(message: string): string | null {
    const route = router.route(message);
    assert.equal(route?.department, 'finance', `"${message}" deveria rotear para o departamento finance`);

    return interpreter.interpret(message, 'finance')?.toolHandler ?? null;
  }

  const SUMMARY_CASES = [
    'quanto temos a receber',
    'quanto temos para receber',
    'quanto temos a receber no total',
    'total a receber',
    'quanto temos a pagar',
    'quanto temos para pagar',
    'total a pagar',
  ];

  for (const message of SUMMARY_CASES) {
    test(`"${message}" → finance.get_summary`, () => {
      assert.equal(financeTool(message), 'finance.get_summary');
    });
  }

  const OVERDUE_RECEIVABLE_CASES = [
    'quanto temos vencido para receber',
    'recebimentos em atraso',
    'clientes devendo',
    'contas a receber vencidas',
  ];

  for (const message of OVERDUE_RECEIVABLE_CASES) {
    test(`"${message}" → finance.get_overdue_receivables`, () => {
      assert.equal(financeTool(message), 'finance.get_overdue_receivables');
    });
  }

  const OVERDUE_PAYABLE_CASES = [
    'quanto temos a pagar em atraso',
    'contas vencidas para pagar',
    'pagamentos em atraso',
  ];

  for (const message of OVERDUE_PAYABLE_CASES) {
    test(`"${message}" → finance.get_overdue_payables`, () => {
      assert.equal(financeTool(message), 'finance.get_overdue_payables');
    });
  }

  test('marcadores de atraso têm precedência mesmo com "receber"/"pagar" na mesma frase', () => {
    assert.equal(financeTool('quanto temos a receber que já está vencido'), 'finance.get_overdue_receivables');
    assert.equal(financeTool('quanto temos a pagar que está atrasado'), 'finance.get_overdue_payables');
  });

  test('plural dos marcadores de atraso continua funcionando (vencidos/vencidas/atrasados/atrasadas/inadimplentes)', () => {
    assert.equal(financeTool('contas a pagar vencidas'), 'finance.get_overdue_payables');
    assert.equal(financeTool('boletos vencidos para pagar'), 'finance.get_overdue_payables');
    assert.equal(financeTool('pagamentos atrasados'), 'finance.get_overdue_payables');
    assert.equal(financeTool('recebimentos atrasados'), 'finance.get_overdue_receivables');
    assert.equal(financeTool('clientes inadimplentes'), 'finance.get_overdue_receivables');
  });

  test('"inadimplente" sozinho (sem "pagar") é sempre recebível', () => {
    assert.equal(financeTool('temos algum cliente inadimplente?'), 'finance.get_overdue_receivables');
  });

  test('sem nenhum marcador de atraso e sem receber/pagar, cai no default do departamento (get_summary)', () => {
    assert.equal(financeTool('como está o financeiro esse mês?'), 'finance.get_summary');
  });

  test('"atrasado" sozinho, fora do contexto financeiro, continua roteando para projects', () => {
    const route = router.route('Quais projetos estão atrasados?');
    assert.equal(route?.department, 'projects');
  });
});
