import { z } from 'zod';

import { registerTool } from '../tool-registry.js';
import type { ToolDefinition } from '../types.js';

/**
 * Tool registrada apenas para os testes do fluxo de aprovação (seção 57,
 * casos #9/#10/#11). Nenhuma tool do catálogo v1 é legitimamente
 * approval_required (os candidatos naturais — cobrança, deploy,
 * cancelamento — estão fora de escopo pela seção 26/63), então o fluxo é
 * exercitado aqui com uma tool inofensiva que só incrementa um contador
 * em memória — nunca importada por agents/tools/index.ts nem por
 * app.ts, só pelo arquivo de teste que precisa dela.
 */
export let testApprovalSideEffectCount = 0;

export function resetTestApprovalSideEffectCount() {
  testApprovalSideEffectCount = 0;
}

const emptyInput = z.object({}).strict();

export const testApprovalRequiredEcho: ToolDefinition<Record<string, never>> = {
  handler: 'test.approval_required_echo',
  requiredPermission: 'agents.use',
  inputSchema: emptyInput,
  async run() {
    testApprovalSideEffectCount += 1;

    return {
      success: true,
      summary: 'Efeito de teste executado.',
      data: { count: testApprovalSideEffectCount },
    };
  },
};

let registered = false;

export function registerTestSupportTools() {
  if (registered) {
    return;
  }

  registerTool(testApprovalRequiredEcho);
  registered = true;
}
