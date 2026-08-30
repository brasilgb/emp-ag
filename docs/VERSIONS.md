# VERSIONS.md

## Infraestrutura Base — Agência

Data de referência: 29/08/2026

Este documento registra as versões fixadas dos principais componentes da infraestrutura local da agência.

O objetivo é garantir consistência entre desenvolvimento, testes e futura produção.

---

## Docker

### Docker Engine

Gerenciado pelo repositório oficial do Docker para Debian.

Verificar versão instalada com:

```bash
docker --version
```

---

## Docker Compose

Utilizado através do plugin oficial:

```bash
docker compose
```

Verificar versão instalada com:

```bash
docker compose version
```

---

## PostgreSQL

Versão utilizada:

```text
17.11
```

Imagem Docker:

```text
postgres:17.11-alpine
```

Container:

```text
agencia-postgres
```

Banco principal da aplicação:

```text
agencia
```

Banco utilizado pelo n8n:

```text
n8n
```

Verificar versão:

```bash
docker exec agencia-postgres postgres --version
```

---

## Redis

Versão utilizada:

```text
7.4.11
```

Imagem Docker:

```text
redis:7.4.11-alpine
```

Container:

```text
agencia-redis
```

Persistência habilitada através de AOF:

```text
appendonly yes
```

Verificar versão:

```bash
docker exec agencia-redis redis-server --version
```

---

## n8n

Versão utilizada:

```text
2.36.8
```

Imagem Docker:

```text
n8nio/n8n:2.36.8
```

Container:

```text
agencia-n8n
```

Porta local:

```text
127.0.0.1:5678
```

Banco de dados:

```text
PostgreSQL / n8n
```

Verificar versão:

```bash
docker exec agencia-n8n n8n --version
```

---

# Rede Docker

Nome da rede:

```text
agencia-network
```

Tipo:

```text
bridge
```

Os serviços internos se comunicam utilizando os nomes definidos no Docker Compose.

Exemplo:

```text
postgres:5432
redis:6379
```

PostgreSQL e Redis não possuem portas publicadas externamente.

---

# Volumes

Volumes persistentes utilizados:

```text
postgres_data
redis_data
n8n_data
```

Funções:

```text
postgres_data
→ dados dos bancos PostgreSQL

redis_data
→ persistência do Redis

n8n_data
→ configurações e dados locais do n8n
```

Os volumes não devem ser removidos sem backup.

Evitar:

```bash
docker compose down -v
```

em ambientes que contenham dados importantes.

---

# Healthchecks

PostgreSQL:

```text
pg_isready
```

Redis:

```text
redis-cli ping
```

Verificar:

```bash
docker compose ps
```

Estado esperado:

```text
agencia-postgres   healthy
agencia-redis      healthy
agencia-n8n        Up
```

---

# Estrutura atual

```text
empresa-agentes/
├── backend/
├── frontend/
├── n8n/
├── docs/
│   └── VERSIONS.md
├── docker/
│   └── postgres/
│       └── init.sql
├── docker-compose.yml
├── .env
└── .gitignore
```

---

# Política de versões

Não utilizar `latest` nos componentes principais da infraestrutura.

Exemplo incorreto:

```text
postgres:latest
redis:latest
n8nio/n8n:latest
```

Utilizar versões fixas:

```text
postgres:17.11-alpine
redis:7.4.11-alpine
n8nio/n8n:2.36.8
```

---

# Processo de atualização

Antes de atualizar qualquer componente:

1. Consultar changelog e release notes.
2. Identificar breaking changes.
3. Realizar backup dos dados.
4. Atualizar primeiro no ambiente de desenvolvimento.
5. Recriar os containers.
6. Verificar healthchecks.
7. Verificar logs.
8. Testar a aplicação.
9. Somente depois atualizar produção.

Fluxo:

```text
Nova versão
    ↓
Release notes
    ↓
Backup
    ↓
Atualização local
    ↓
Healthcheck
    ↓
Testes
    ↓
Homologação
    ↓
Produção
```

---

# Comandos úteis

Status:

```bash
docker compose ps
```

Logs:

```bash
docker compose logs --tail=100
```

Logs em tempo real:

```bash
docker compose logs -f
```

Baixar imagens:

```bash
docker compose pull
```

Aplicar alterações:

```bash
docker compose up -d
```

Parar os serviços:

```bash
docker compose down
```

Listar imagens:

```bash
docker compose images
```

Listar volumes:

```bash
docker volume ls
```

Listar redes:

```bash
docker network ls
```

---

# Próximos componentes previstos

Ainda não adicionados:

```text
Backend / API
Frontend
Worker de tarefas
Fila de jobs
Nginx
Monitoramento
Backup automatizado
CI/CD
```

As versões desses componentes deverão ser registradas neste arquivo assim que forem adicionados ao ambiente.

---

## Regra principal

A infraestrutura deve ser reproduzível.

Um novo ambiente deverá poder ser criado a partir de:

```text
código-fonte
+
docker-compose.yml
+
arquivos de configuração
+
variáveis de ambiente
+
backups quando necessários
```

sem depender de configurações manuais escondidas no servidor.
