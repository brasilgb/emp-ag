#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups/postgres"

TEST_DB="agencia_restore_test"

LATEST=$(ls -t "$BACKUP_DIR"/agencia_*.dump 2>/dev/null | head -n 1)

if [ -z "${LATEST:-}" ]; then
  echo "ERRO: nenhum backup do banco agencia foi encontrado."
  exit 1
fi

echo "========================================"
echo "Teste de Restore PostgreSQL"
echo "Backup: $LATEST"
echo "========================================"

echo
echo "[1/6] Verificando integridade SHA-256..."

HASH_FILE="${LATEST}.sha256"

if [ ! -f "$HASH_FILE" ]; then
  echo "ERRO: arquivo SHA-256 não encontrado:"
  echo "$HASH_FILE"
  exit 1
fi

sha256sum -c "$HASH_FILE"

echo
echo "[2/6] Validando formato do dump..."

docker exec -i agencia-postgres \
  pg_restore --list \
  < "$LATEST" \
  > /dev/null

echo "Dump válido."

echo
echo "[3/6] Removendo banco de teste anterior, se existir..."

docker exec agencia-postgres \
  dropdb \
  -U agencia \
  --if-exists \
  "$TEST_DB"

echo
echo "[4/6] Criando banco de teste..."

docker exec agencia-postgres \
  createdb \
  -U agencia \
  "$TEST_DB"

echo
echo "[5/6] Restaurando backup..."

docker exec -i agencia-postgres \
  pg_restore \
  -U agencia \
  -d "$TEST_DB" \
  < "$LATEST"

echo "Restore concluído."

echo
echo "[6/6] Validando banco restaurado..."

docker exec agencia-postgres \
  psql \
  -U agencia \
  -d "$TEST_DB" \
  -c "SELECT current_database(), version();"

docker exec agencia-postgres \
  psql \
  -U agencia \
  -d "$TEST_DB" \
  -c "\dt"

echo
echo "Removendo banco temporário..."

docker exec agencia-postgres \
  dropdb \
  -U agencia \
  "$TEST_DB"

echo
echo "========================================"
echo "RESTORE TESTADO COM SUCESSO"
echo "========================================"
