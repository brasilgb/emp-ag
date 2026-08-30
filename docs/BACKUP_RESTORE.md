# BACKUP_RESTORE.md

## Estratégia de Backup e Restore

Este documento define o processo de backup e restauração dos principais dados da infraestrutura da agência.

Objetivo:

* proteger dados empresariais
* permitir recuperação após falha
* validar que os backups realmente podem ser restaurados
* preparar o ambiente para futura operação em produção

Regra principal:

```text
Volume Docker não é backup.
```

Um volume pode persistir dados após recriação de containers, mas não protege contra:

* corrupção
* exclusão acidental
* falha de disco
* erro humano
* ransomware
* perda do servidor
* remoção do próprio volume

Por isso os dados devem possuir cópias externas e restauráveis.

---

# 1. Componentes que exigem backup

Atualmente:

```text
PostgreSQL
n8n
configurações
.env
documentação
```

Posteriormente:

```text
uploads
arquivos de clientes
documentos
logs importantes
certificados
configurações Nginx
dados de aplicações
```

---

# 2. Estrutura de diretórios

Criar:

```bash
mkdir -p backups/postgres
mkdir -p backups/n8n
mkdir -p backups/config
mkdir -p scripts
```

Estrutura:

```text
empresa-agentes/
├── backups/
│   ├── postgres/
│   ├── n8n/
│   └── config/
├── scripts/
├── backend/
├── frontend/
├── n8n/
├── docs/
├── docker/
├── docker-compose.yml
├── .env
└── .gitignore
```

Os arquivos de backup não devem ser versionados no Git.

Adicionar ao `.gitignore`:

```gitignore
backups/
*.sql
*.dump
*.tar.gz
```

---

# 3. Backup PostgreSQL

O PostgreSQL possui atualmente dois bancos:

```text
agencia
n8n
```

O banco `agencia` contém os dados da aplicação.

O banco `n8n` contém os dados internos do n8n.

Os dois devem ser incluídos na estratégia de backup.

---

# 4. Backup manual do banco agencia

Comando:

```bash
docker exec agencia-postgres \
  pg_dump \
  -U agencia \
  -d agencia \
  -Fc \
  > backups/postgres/agencia.dump
```

A opção:

```text
-Fc
```

utiliza o formato custom do PostgreSQL.

Esse formato é recomendado porque permite restauração flexível com `pg_restore`.

Verificar arquivo:

```bash
ls -lh backups/postgres/agencia.dump
```

---

# 5. Backup manual do banco n8n

```bash
docker exec agencia-postgres \
  pg_dump \
  -U agencia \
  -d n8n \
  -Fc \
  > backups/postgres/n8n.dump
```

Verificar:

```bash
ls -lh backups/postgres/
```

---

# 6. Backup completo do PostgreSQL

Para gerar um backup de todos os bancos e objetos globais:

```bash
docker exec agencia-postgres \
  pg_dumpall \
  -U agencia \
  > backups/postgres/postgres-all.sql
```

Esse formato contém:

* bancos
* tabelas
* dados
* roles
* objetos globais

É útil como backup complementar.

Não substitui obrigatoriamente os dumps individuais.

---

# 7. Backup com data e hora

Não sobrescrever backups anteriores.

Utilizar timestamp.

Exemplo:

```bash
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
```

Backup:

```bash
docker exec agencia-postgres \
  pg_dump \
  -U agencia \
  -d agencia \
  -Fc \
  > "backups/postgres/agencia_${TIMESTAMP}.dump"
```

Resultado:

```text
agencia_2026-08-29_17-30-00.dump
```

---

# 8. Script de backup PostgreSQL

Arquivo:

```text
scripts/backup-postgres.sh
```

Conteúdo:

```bash
#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups/postgres"

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")

mkdir -p "$BACKUP_DIR"

echo "Iniciando backup PostgreSQL..."

docker exec agencia-postgres \
  pg_dump \
  -U agencia \
  -d agencia \
  -Fc \
  > "$BACKUP_DIR/agencia_${TIMESTAMP}.dump"

docker exec agencia-postgres \
  pg_dump \
  -U agencia \
  -d n8n \
  -Fc \
  > "$BACKUP_DIR/n8n_${TIMESTAMP}.dump"

echo "Backup concluído."

echo
echo "Arquivos:"
ls -lh "$BACKUP_DIR"/*"${TIMESTAMP}"*
```

Dar permissão:

```bash
chmod +x scripts/backup-postgres.sh
```

Executar:

```bash
./scripts/backup-postgres.sh
```

---

# 9. Verificação do dump

Um arquivo existir não significa que ele seja válido.

Utilizar:

```bash
docker exec -i agencia-postgres \
  pg_restore --list \
  < backups/postgres/agencia_YYYY-MM-DD_HH-MM-SS.dump
```

Se o dump estiver válido, o PostgreSQL exibirá a lista dos objetos armazenados.

Também é possível testar:

```bash
docker exec -i agencia-postgres \
  pg_restore --list \
  < backups/postgres/n8n_YYYY-MM-DD_HH-MM-SS.dump
```

---

# 10. Teste de restore

Nunca testar restore diretamente sobre o banco principal.

Criar um banco temporário:

```bash
docker exec -it agencia-postgres \
  createdb \
  -U agencia \
  agencia_restore_test
```

Confirmar:

```bash
docker exec -it agencia-postgres \
  psql \
  -U agencia \
  -l
```

---

# 11. Restaurar backup em banco de teste

Utilizar:

```bash
docker exec -i agencia-postgres \
  pg_restore \
  -U agencia \
  -d agencia_restore_test \
  < backups/postgres/agencia_YYYY-MM-DD_HH-MM-SS.dump
```

Depois verificar:

```bash
docker exec -it agencia-postgres \
  psql \
  -U agencia \
  -d agencia_restore_test
```

Dentro do PostgreSQL:

```sql
\dt
```

Ver algumas tabelas:

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public';
```

Sair:

```sql
\q
```

---

# 12. Remover banco de teste

Depois da validação:

```bash
docker exec -it agencia-postgres \
  dropdb \
  -U agencia \
  agencia_restore_test
```

---

# 13. Restore do banco principal

Somente realizar após confirmar:

* backup correto
* arquivo íntegro
* necessidade real
* aplicação parada quando necessário

Fluxo:

```text
parar aplicações
    ↓
validar backup
    ↓
criar backup do estado atual
    ↓
remover ou recriar banco
    ↓
restaurar
    ↓
validar dados
    ↓
subir aplicações
```

---

# 14. Restaurar banco agencia

Primeiro criar um backup de emergência do estado atual:

```bash
./scripts/backup-postgres.sh
```

Parar serviços que utilizam o banco:

```bash
docker compose stop n8n
```

Futuramente:

```text
backend
workers
n8n
```

também devem ser parados.

Remover banco:

```bash
docker exec -it agencia-postgres \
  dropdb \
  -U agencia \
  agencia
```

Criar novamente:

```bash
docker exec -it agencia-postgres \
  createdb \
  -U agencia \
  agencia
```

Restaurar:

```bash
docker exec -i agencia-postgres \
  pg_restore \
  -U agencia \
  -d agencia \
  < backups/postgres/agencia_BACKUP.dump
```

---

# 15. Restaurar banco n8n

Parar o n8n:

```bash
docker compose stop n8n
```

Remover:

```bash
docker exec -it agencia-postgres \
  dropdb \
  -U agencia \
  n8n
```

Criar:

```bash
docker exec -it agencia-postgres \
  createdb \
  -U agencia \
  n8n
```

Restaurar:

```bash
docker exec -i agencia-postgres \
  pg_restore \
  -U agencia \
  -d n8n \
  < backups/postgres/n8n_BACKUP.dump
```

Depois:

```bash
docker compose start n8n
```

Verificar:

```bash
docker compose logs --tail=100 n8n
```

---

# 16. Backup do n8n

O n8n possui dois componentes importantes:

```text
Banco PostgreSQL
+
volume n8n_data
```

O banco contém a maior parte do estado do n8n.

O volume pode conter configurações e dados locais adicionais.

Por isso os dois devem ser protegidos.

---

# 17. Backup do volume n8n

Criar diretório:

```bash
mkdir -p backups/n8n
```

Backup:

```bash
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")

docker run --rm \
  -v empresa-agentes_n8n_data:/data:ro \
  -v "$(pwd)/backups/n8n:/backup" \
  alpine \
  tar czf "/backup/n8n_data_${TIMESTAMP}.tar.gz" -C /data .
```

O nome real do volume pode variar.

Confirmar antes:

```bash
docker volume ls
```

Também pode obter o volume diretamente:

```bash
docker inspect agencia-n8n
```

---

# 18. Restore do volume n8n

Parar:

```bash
docker compose stop n8n
```

Restaurar:

```bash
docker run --rm \
  -v empresa-agentes_n8n_data:/data \
  -v "$(pwd)/backups/n8n:/backup" \
  alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/n8n_data_BACKUP.tar.gz -C /data"
```

Depois:

```bash
docker compose start n8n
```

---

# 19. N8N_ENCRYPTION_KEY

A variável:

```text
N8N_ENCRYPTION_KEY
```

é crítica.

Ela é utilizada pelo n8n para criptografar credenciais.

Sem a mesma chave, credenciais restauradas podem não ser utilizáveis.

Portanto o backup do n8n deve incluir de forma segura:

```text
N8N_ENCRYPTION_KEY
```

Nunca armazenar essa chave em repositório público.

---

# 20. Backup das configurações

Arquivos importantes:

```text
docker-compose.yml
.env
docker/
docs/
scripts/
```

O código e a documentação podem ser versionados em Git.

O `.env` não deve ser enviado ao Git.

Criar backup separado:

```bash
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")

tar czf \
  "backups/config/config_${TIMESTAMP}.tar.gz" \
  docker-compose.yml \
  docker \
  scripts \
  docs
```

O `.env` deve ser copiado para armazenamento seguro separado.

---

# 21. Backup do .env

Nunca colocar:

```text
.env
```

em GitHub público.

Pode manter cópia criptografada em:

* gerenciador de senhas
* armazenamento seguro
* cofre de secrets
* mídia externa protegida

O `.env` possui dados necessários para recuperar o ambiente.

---

# 22. Política de retenção

Sugestão inicial:

```text
Diário:
7 dias

Semanal:
4 semanas

Mensal:
6 meses
```

Isso pode evoluir conforme a empresa crescer.

---

# 23. Limpeza de backups antigos

Exemplo:

```bash
find backups/postgres \
  -type f \
  -mtime +30 \
  -delete
```

Isso remove arquivos com mais de 30 dias.

Não automatizar exclusão antes de definir oficialmente a política de retenção.

---

# 24. Backup automatizado

Posteriormente utilizar:

```text
cron
systemd timer
n8n
ou serviço dedicado
```

Para backup de infraestrutura Linux, preferência:

```text
systemd timer
ou cron
```

O backup do próprio n8n não deve depender exclusivamente do n8n.

---

# 25. Exemplo com cron

Editar:

```bash
crontab -e
```

Exemplo de backup diário às 02:00:

```cron
0 2 * * * /home/anderson/empresa-agentes/scripts/backup-postgres.sh >> /home/anderson/empresa-agentes/backups/backup.log 2>&1
```

Em produção, verificar timezone do servidor antes de configurar horários.

---

# 26. Armazenamento externo

Backup armazenado somente no mesmo servidor não é suficiente.

Utilizar pelo menos uma cópia externa.

Possibilidades:

```text
Google Drive
S3
Backblaze B2
Wasabi
servidor remoto
NAS
HD externo
```

Ferramentas como:

```text
rclone
```

podem automatizar envio para armazenamento externo.

---

# 27. Regra 3-2-1

Objetivo futuro:

```text
3 cópias dos dados
2 tipos diferentes de armazenamento
1 cópia fora do servidor
```

Exemplo:

```text
Dados ativos
+
backup local
+
backup remoto
```

---

# 28. Integridade

Posteriormente gerar hashes:

```bash
sha256sum backups/postgres/agencia_BACKUP.dump
```

Salvar resultado:

```bash
sha256sum backups/postgres/agencia_BACKUP.dump \
  > backups/postgres/agencia_BACKUP.dump.sha256
```

Validar:

```bash
sha256sum -c backups/postgres/agencia_BACKUP.dump.sha256
```

---

# 29. Criptografia

Backups contendo dados reais de clientes devem ser protegidos.

Em produção considerar:

```text
criptografia em repouso
criptografia durante transporte
controle de acesso
retenção adequada
```

Nunca armazenar backups empresariais sensíveis publicamente.

---

# 30. Monitoramento de backup

Futuramente o sistema deverá registrar:

```text
último backup
status
tamanho
duração
destino
hash
erro
último teste de restore
```

Exemplo:

```text
PostgreSQL

Último backup:
2026-08-29 02:00

Status:
OK

Tamanho:
240 MB

Destino:
local + remoto

Último restore testado:
2026-08-25
```

---

# 31. Falha de backup

Se um backup falhar:

```text
registrar erro
    ↓
notificar administrador
    ↓
corrigir problema
    ↓
executar novamente
    ↓
validar arquivo
```

Nunca considerar o backup concluído apenas porque o script foi executado.

---

# 32. Testes periódicos de restore

Sugestão inicial:

```text
Backup:
diário

Verificação do arquivo:
diária

Restore de teste:
mensal
```

Em sistemas críticos, a frequência poderá ser maior.

---

# 33. Checklist de backup

Antes de considerar o backup válido:

```text
[ ] arquivo foi criado
[ ] tamanho maior que zero
[ ] pg_restore --list funciona
[ ] hash foi gerado
[ ] cópia externa foi realizada
[ ] logs não possuem erros
```

---

# 34. Checklist de restore

```text
[ ] backup correto foi identificado
[ ] hash validado
[ ] aplicação foi protegida contra novas escritas
[ ] estado atual foi salvo
[ ] banco de teste foi restaurado
[ ] dados foram validados
[ ] restore principal foi executado
[ ] aplicação voltou a funcionar
[ ] logs foram revisados
```

---

# 35. Procedimento de desastre

Em caso de perda completa do servidor:

```text
novo servidor Debian
    ↓
instalar Docker
    ↓
clonar repositório
    ↓
restaurar .env
    ↓
docker compose up
    ↓
restaurar PostgreSQL
    ↓
restaurar n8n_data
    ↓
validar serviços
    ↓
restaurar DNS/Nginx
    ↓
validar aplicação
```

---

# 36. Objetivo de recuperação

Futuramente deverão ser definidos:

```text
RPO
RTO
```

RPO:

```text
Recovery Point Objective
```

Quanto de dados podemos aceitar perder.

Exemplo:

```text
RPO = 24 horas
```

significa que o último backup pode possuir até 24 horas.

RTO:

```text
Recovery Time Objective
```

Quanto tempo podemos levar para recuperar o serviço.

Exemplo:

```text
RTO = 2 horas
```

---

# 37. Meta inicial da agência

Enquanto o ambiente ainda estiver em desenvolvimento:

```text
RPO:
24 horas

RTO:
não crítico
```

Quando clientes reais entrarem:

```text
RPO:
avaliar redução

RTO:
definir conforme SLA e criticidade
```

---

# 38. Regra de ouro

Nunca realizar uma operação destrutiva importante antes de possuir backup recente.

Antes de:

```text
migração
upgrade
alteração de banco
mudança de versão major
refatoração estrutural
restore
remoção de volume
```

executar backup.

---

# 39. Comandos principais

Backup:

```bash
./scripts/backup-postgres.sh
```

Listar:

```bash
ls -lh backups/postgres
```

Validar:

```bash
docker exec -i agencia-postgres \
  pg_restore --list \
  < backups/postgres/ARQUIVO.dump
```

Criar banco de teste:

```bash
docker exec -it agencia-postgres \
  createdb -U agencia agencia_restore_test
```

Restore:

```bash
docker exec -i agencia-postgres \
  pg_restore \
  -U agencia \
  -d agencia_restore_test \
  < backups/postgres/ARQUIVO.dump
```

Excluir teste:

```bash
docker exec -it agencia-postgres \
  dropdb -U agencia agencia_restore_test
```

---

# 40. Princípio Final

Backup deve ser tratado como parte da infraestrutura e não como tarefa opcional.

Um ambiente só deve ser considerado recuperável quando existir:

```text
backup
+
armazenamento seguro
+
documentação
+
teste de restore
```

A meta da agência é garantir que perda de container, volume, servidor ou atualização mal-sucedida não resulte em perda definitiva dos dados empresariais.
