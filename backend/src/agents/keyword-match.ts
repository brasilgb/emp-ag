// Compartilhado entre router/deterministic-router.ts e
// interpreter/deterministic-interpreter.ts (ambos dentro do mesmo módulo
// agents/, diferente da duplicação proposital entre routes/<módulo>
// distintos) — normalização + matching por PALAVRA/FRASE inteira, nunca
// substring cru.
//
// Bug real encontrado via teste de prompt injection (v1.1 seção 32 #11):
// `.includes()` cru batia "pagar" dentro de "apagar", fazendo o roteador
// determinístico reconhecer "apague a tabela users" como intenção
// financeira. Corrigido usando limites de palavra (\b) depois de
// normalizar.

// Combining Diacritical Marks (U+0300–U+036F) — removidos após
// normalize('NFD') para comparar sem acento (ex.: "crítico" ~ "critico").
const DIACRITICS_PATTERN = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalizeText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(DIACRITICS_PATTERN, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `\b` funciona corretamente aqui porque normalizeText() já removeu os
// acentos (o texto normalizado só tem caracteres ASCII + espaços/
// pontuação), então os limites de palavra do regex caem exatamente onde
// esperado. Funciona também para frases de mais de uma palavra (ex.:
// "cliente potencial") — os `\b` ficam nas bordas da frase inteira.
//
// `s?` antes do `\b` final: plural em português normalmente só acrescenta
// "s" (projeto→projetos, atrasado→atrasados, chamado→chamados) — sem
// isso, mensagens reais como "Quais projetos estão atrasados?" deixariam
// de bater com as keywords "projeto"/"atrasado". Continua rejeitando
// "apagar" para a keyword "pagar": o `\b` inicial não bate entre "a" e
// "p" (ambos caracteres de palavra), então a posição nem chega a ser
// testada.
export function matchesKeyword(normalizedText: string, keyword: string): boolean {
  const normalizedKeyword = normalizeText(keyword);
  const pattern = new RegExp(`\\b${escapeRegExp(normalizedKeyword)}s?\\b`);
  return pattern.test(normalizedText);
}
