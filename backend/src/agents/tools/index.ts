import { registerCsTools } from './cs.js';
import { registerDirectorTools } from './director.js';
import { registerFinanceTools } from './finance.js';
import { registerProjectsTools } from './projects.js';
import { registerSalesTools } from './sales.js';
import { registerSupportTools } from './support.js';

let registered = false;

// Idempotente: buildApp() pode ser chamado mais de uma vez (ex.: nos
// testes, um app por arquivo de teste) — registerTool() lança em caso de
// handler duplicado, então evitamos registrar duas vezes no mesmo
// processo.
export function registerAllTools() {
  if (registered) {
    return;
  }

  registerDirectorTools();
  registerSalesTools();
  registerProjectsTools();
  registerFinanceTools();
  registerSupportTools();
  registerCsTools();

  registered = true;
}
