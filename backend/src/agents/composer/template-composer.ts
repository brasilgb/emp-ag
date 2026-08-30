import type { ComposeInput, ResponseComposer } from './types.js';

// Seção 34: `message` é só o texto de resposta (ex.: "Há 3 projetos
// atrasados.") — a transparência de qual tool foi consultada (seção 42)
// já viaja em campos separados na resposta do chat (`agent`, `tool`,
// ver routes/agents/chat.ts) para o frontend exibir discretamente, nunca
// concatenada aqui dentro do texto.
export class TemplateResponseComposer implements ResponseComposer {
  compose({ result }: ComposeInput): string {
    return result.summary;
  }
}
