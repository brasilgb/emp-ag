#!/usr/bin/env bash

set -euo pipefail

# Agentes v1.1 — LLM Interpreter + Shadow Mode (correio.md seção 33).
#
# Dispara a bateria de perguntas manuais (financeiro/projetos/suporte/CS/
# diretor) contra POST /agents/chat e imprime, para cada uma,
# determinístico vs LLM lado a lado (lidos de agent_interpretations logo
# depois da chamada).
#
# Pré-requisitos:
#   - docker compose up -d (backend/postgres precisam estar healthy)
#   - AGENT_LLM_ENABLED=true e AGENT_LLM_API_KEY=<key real> no .env,
#     seguido de `docker compose up -d backend` para recarregar o container
#     com a nova env (AGENT_LLM_SHADOW_MODE pode ficar true — shadow é
#     justamente o modo usado para esta comparação, seção 34: não é
#     necessário nem recomendado ativar fallback só para rodar isto)
#
# Uso:
#   ./scripts/run-shadow-manual-tests.sh

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL="${API_URL:-http://127.0.0.1:8000}"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

: "${CEO_EMAIL:?CEO_EMAIL precisa estar definido (.env ou variável de ambiente).}"
: "${CEO_PASSWORD:?CEO_PASSWORD precisa estar definido (.env ou variável de ambiente).}"

echo "========================================"
echo "Testes manuais em Shadow Mode — Agentes v1.1"
echo "API: $API_URL"
echo "========================================"

echo
echo "[1/3] Verificando backend..."
if ! curl -fsS "$API_URL/health" >/dev/null; then
  echo "ERRO: backend não respondeu em $API_URL/health. Rode 'docker compose up -d' primeiro."
  exit 1
fi
echo "Backend respondendo."

echo
echo "[2/3] Login como CEO..."
TOKEN=$(curl -fsS -X POST "$API_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${CEO_EMAIL}\",\"password\":\"${CEO_PASSWORD}\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

if [ -z "$TOKEN" ]; then
  echo "ERRO: falha no login."
  exit 1
fi
echo "Login OK."

echo
echo "[3/3] Disparando perguntas (seção 33)..."
echo

# "pergunta|departamento esperado" — um por linha.
QUESTIONS=(
  "Quanto temos para receber?|financeiro"
  "Como está nosso caixa?|financeiro"
  "Tem alguém devendo?|financeiro"
  "Quais contas estão vencidas?|financeiro"
  "Quais projetos estão atrasados?|projetos"
  "Tem alguma entrega preocupante?|projetos"
  "Há tarefas bloqueadas?|projetos"
  "Quem está com trabalho vencido?|projetos"
  "Tem chamado crítico?|suporte"
  "Estamos estourando SLA?|suporte"
  "Quais tickets precisam de atenção?|suporte"
  "Tem cliente em risco?|customer success"
  "Quem precisa de contato?|customer success"
  "Onde há oportunidade de expansão?|customer success"
  "Como está a empresa?|diretor"
  "Tem alguma coisa que precisa da minha atenção?|diretor"
  "Me dê um panorama do negócio.|diretor"
)

printf "%-45s | %-16s | %-16s | %-30s | %-6s | %s\n" "Pergunta" "Área esperada" "Determinístico" "LLM" "Conf." "Match"
printf -- '-%.0s' {1..140}
echo

for entry in "${QUESTIONS[@]}"; do
  question="${entry%%|*}"
  expected="${entry##*|}"

  response=$(curl -fsS -X POST "$API_URL/agents/chat" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "$(node -e "console.log(JSON.stringify({message: process.argv[1]}))" "$question")")

  conversation_id=$(echo "$response" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).conversationId))")

  row=$(docker exec agencia-postgres psql -U agencia -d agencia -t -A -F'|' -c \
    "SELECT deterministic_tool, llm_tool, llm_confidence, matched FROM agent_interpretations WHERE conversation_id = ${conversation_id} ORDER BY created_at DESC LIMIT 1;")

  deterministic_tool=$(echo "$row" | cut -d'|' -f1)
  llm_tool=$(echo "$row" | cut -d'|' -f2)
  confidence=$(echo "$row" | cut -d'|' -f3)
  matched=$(echo "$row" | cut -d'|' -f4)

  printf "%-45s | %-16s | %-16s | %-30s | %-6s | %s\n" \
    "${question:0:45}" "$expected" "${deterministic_tool:-(nenhuma)}" "${llm_tool:-(sem dado — LLM desligado?)}" "${confidence:---}" "${matched:---}"
done

echo
echo "========================================"
echo "Concluído. Veja GET /agents/interpreter/stats (ou a tela /agents/interpreter)"
echo "para match rate, latência média e divergências agregadas."
echo "========================================"
