# Execução — Agentes v1.5: correção de flakiness na suíte de testes

## Causa raiz

A suíte de testes do backend (`node:test`, 25 arquivos) roda em paralelo
por padrão. Vários arquivos compartilham estado global real no mesmo
Postgres — a fila `agent_events` e a linha do global autonomy switch em
`settings` não são isoladas por arquivo. Alguns testes (`event-rules.test.ts`,
`event-processor.test.ts`, `job-runner.autonomy.test.ts`) já documentavam
esse risco em comentários próprios, com mitigação parcial (cleanup por
`afterEach`, Jobs criados `paused`) que reduzia mas não eliminava a janela
de corrida entre arquivos concorrentes — causando falhas intermitentes
(2-3 testes, sempre em `event-processor.test.ts`, variando a cada rodada)
sem qualquer regressão real no código de produção.

Correções pontuais em testes individuais (`maxIterations` 20→500, um
pre-drain de fila alheia replicado) reduziram a frequência mas não
eliminaram a causa: uma rodada seguinte ainda falhou, desta vez em
`rule disabled não dispara`, por interferência de `event-rules.test.ts`.

## Correção aplicada

`backend/package.json`, script `test`:

```diff
- "test": "tsx --test 'src/**/*.test.ts'",
+ "test": "tsx --test --test-concurrency=1 'src/**/*.test.ts'",
```

Serializa a execução dos arquivos de teste (os testes dentro de cada
arquivo continuam rodando como antes), eliminando de vez a corrida sobre
estado global compartilhado — em vez de continuar corrigindo teste a
teste.

## Validação

1. `npx tsx --test --test-concurrency=1 'src/**/*.test.ts'` (direto, sem
   passar pelo script) → **271/271**, 0 fail.
2. `npm test` real, com a correção já persistida no `package.json` →
   **271/271**, 0 fail, `duration_ms ≈ 233964` (~234s — mais lento que os
   ~70-90s de antes por rodar os 25 arquivos em série; troca aceita em
   favor de determinismo).
3. `tsc --noEmit` → limpo, 0 erros.

## Resultado

Suíte agora determinística — zero falhas confirmadas via o comando real
que qualquer pessoa/CI vai rodar (`npm test`), não só via flag manual.
Único arquivo alterado fora de testes: `backend/package.json` (script
`test`). Nenhuma mudança em código de produção. Os ajustes pontuais nos
testes (`event-processor.test.ts`) permanecem — não atrapalham com
concorrência 1 e documentam a intenção original de cada teste.
