#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups/postgres"
LOG_DIR="$PROJECT_DIR/backups/logs"

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="$LOG_DIR/postgres-backup_${TIMESTAMP}.log"

AGENCIA_DUMP="$BACKUP_DIR/agencia_${TIMESTAMP}.dump"
N8N_DUMP="$BACKUP_DIR/n8n_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"
mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "========================================"
echo "Backup PostgreSQL"
echo "Início: $(date)"
echo "========================================"

echo
echo "[1/5] Verificando container PostgreSQL..."

if ! docker inspect -f '{{.State.Running}}' agencia-postgres 2>/dev/null | grep -q true; then
  echo "ERRO: container agencia-postgres não está rodando."
  exit 1
fi

echo "PostgreSQL está rodando."

echo
echo "[2/5] Gerando backup do banco agencia..."

docker exec agencia-postgres \
  pg_dump \
  -U agencia \
  -d agencia \
  -Fc \
  > "$AGENCIA_DUMP"

echo "Criado: $AGENCIA_DUMP"

echo
echo "[3/5] Gerando backup do banco n8n..."

docker exec agencia-postgres \
  pg_dump \
  -U agencia \
  -d n8n \
  -Fc \
  > "$N8N_DUMP"

echo "Criado: $N8N_DUMP"

echo
echo "[4/5] Validando dumps..."

if docker exec -i agencia-postgres \
  pg_restore --list < "$AGENCIA_DUMP" > /dev/null; then
  echo "agencia: dump válido."
else
  echo "ERRO: dump do banco agencia é inválido."
  exit 1
fi

if docker exec -i agencia-postgres \
  pg_restore --list < "$N8N_DUMP" > /dev/null; then
  echo "n8n: dump válido."
else
  echo "ERRO: dump do banco n8n é inválido."
  exit 1
fi

echo
echo "[5/5] Gerando hashes SHA-256..."

sha256sum "$AGENCIA_DUMP" > "${AGENCIA_DUMP}.sha256"
sha256sum "$N8N_DUMP" > "${N8N_DUMP}.sha256"

echo
echo "Hashes:"
cat "${AGENCIA_DUMP}.sha256"
cat "${N8N_DUMP}.sha256"

echo
echo "Tamanhos:"
ls -lh \
  "$AGENCIA_DUMP" \
  "$N8N_DUMP" \
  "${AGENCIA_DUMP}.sha256" \
  "${N8N_DUMP}.sha256"

echo
echo "========================================"
echo "Backup concluído com sucesso."
echo "Fim: $(date)"
echo "Log: $LOG_FILE"
echo "========================================"