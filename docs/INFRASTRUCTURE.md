# INFRASTRUCTURE.md

## Visão Geral da Infraestrutura

Este documento descreve a infraestrutura inicial da agência, seus serviços, responsabilidades, comunicação entre containers e princípios operacionais.

O objetivo é manter o ambiente simples, isolado, reproduzível e preparado para evolução futura.

---

# 1. Objetivo da Infraestrutura

A infraestrutura deve suportar:

* Sistema interno da agência
* Automação com n8n
* Banco de dados principal
* Filas e cache
* Agentes de IA
* Processos em background
* Integrações externas
* Monitoramento
* Backups
* Futuro deploy em produção

A arquitetura deve permitir desenvolvimento local e posterior migração para VPS ou servidor de produção com poucas alterações.

---

# 2. Ambiente Atual

Sistema operacional:

```text
Debian
```

Diretório principal do projeto:

```text
~/empresa-agentes
```

Estrutura:

```text
empresa-agentes/
├── backend/
├── frontend/
├── n8n/
├── docs/
│   ├── VERSIONS.md
│   └── INFRASTRUCTURE.md
├── docker/
│   └── postgres/
│       └── init.sql
├── docker-compose.yml
├── .env
└── .gitignore
```

---

# 3. Docker

Toda a infraestrutura principal será executada através de containers Docker.

O Docker permite:

* Isolamento entre serviços
* Controle de versões
* Facilidade de atualização
* Facilidade de rollback
* Reprodutibilidade
* Menor dependência do sistema operacional
* Migração simplificada entre ambientes

Cada serviço possui seu próprio container.

---

# 4. Docker Compose

O Docker Compose é responsável por definir e executar o conjunto de serviços da aplicação.

Arquivo principal:

```text
docker-compose.yml
```

Comando para iniciar:

```bash
docker compose up -d
```

Comando para verificar:

```bash
docker compose ps
```

Comando para parar:

```bash
docker compose down
```

---

# 5. Rede Interna

Rede Docker:

```text
agencia-network
```

Tipo:

```text
bridge
```

Todos os serviços internos pertencem a essa rede.

Isso permite comunicação utilizando o nome do serviço.

Exemplo:

```text
postgres:5432
```

em vez de:

```text
127.0.0.1:5432
```

Dentro de um container, `localhost` representa o próprio container.

Por esse motivo, os serviços devem utilizar os nomes definidos no Docker Compose.

---

# 6. Arquitetura Atual

```text
                     Usuário
                        │
                        ▼
                ┌───────────────┐
                │      n8n      │
                │  localhost    │
                │     5678      │
                └───────┬───────┘
                        │
                        │
             agencia-network
                        │
            ┌───────────┴───────────┐
            │                       │
            ▼                       ▼
    ┌───────────────┐       ┌───────────────┐
    │  PostgreSQL   │       │     Redis     │
    │     5432      │       │     6379      │
    └───────────────┘       └───────────────┘
```

PostgreSQL e Redis não possuem portas expostas externamente.

O n8n está disponível apenas localmente:

```text
127.0.0.1:5678
```

---

# 7. PostgreSQL

Container:

```text
agencia-postgres
```

Responsabilidade:

Armazenar dados persistentes e oficiais da plataforma.

Banco principal:

```text
agencia
```

Banco do n8n:

```text
n8n
```

O banco principal futuramente armazenará:

* Usuários
* Empresas
* Clientes
* Leads
* Contatos
* Propostas
* Projetos
* Tarefas
* Financeiro
* Tickets
* Agentes
* Aprovações
* Histórico
* Auditoria

---

# 8. Persistência PostgreSQL

Volume:

```text
postgres_data
```

O volume é responsável por manter os dados mesmo quando o container é removido ou recriado.

Fluxo:

```text
Container PostgreSQL
        │
        ▼
postgres_data
        │
        ▼
dados persistentes
```

Remover o container não remove automaticamente os dados.

Evitar:

```bash
docker compose down -v
```

quando houver dados importantes.

---

# 9. Inicialização PostgreSQL

Arquivo:

```text
docker/postgres/init.sql
```

Responsável por criar recursos iniciais durante a primeira inicialização do volume.

Exemplo atual:

```sql
CREATE DATABASE n8n;
```

Arquivos dentro de:

```text
/docker-entrypoint-initdb.d/
```

são executados apenas quando o diretório de dados do PostgreSQL é criado pela primeira vez.

Se o volume já possuir dados, a inicialização não será executada novamente.

---

# 10. Redis

Container:

```text
agencia-redis
```

Responsabilidades futuras:

* Cache
* Filas
* Jobs
* Locks
* Controle de concorrência
* Eventos temporários
* Rate limiting
* Processamento assíncrono

Redis não será utilizado como banco principal.

Dados empresariais oficiais devem permanecer no PostgreSQL.

---

# 11. Persistência Redis

Volume:

```text
redis_data
```

Modo atual:

```text
AOF
```

Configuração:

```text
appendonly yes
```

AOF significa Append Only File.

As operações são registradas para permitir reconstrução do estado do Redis após reinício.

---

# 12. Redis e Memória do Linux

O sistema operacional deve possuir:

```text
vm.overcommit_memory = 1
```

Verificar:

```bash
sysctl vm.overcommit_memory
```

Configuração persistente:

```text
/etc/sysctl.d/99-redis.conf
```

Conteúdo:

```text
vm.overcommit_memory = 1
```

---

# 13. n8n

Container:

```text
agencia-n8n
```

Responsabilidade:

Executar automações operacionais e integrações.

Exemplos futuros:

* Enviar e-mails
* Enviar mensagens
* Criar follow-ups
* Executar rotinas
* Integrar APIs
* Processar webhooks
* Criar notificações
* Sincronizar informações
* Executar workflows programados

O n8n não deve substituir o backend principal da aplicação.

---

# 14. Papel do n8n

Regra arquitetural:

```text
Backend
= regras de negócio
```

```text
n8n
= automação
```

Exemplo:

```text
Backend cria cliente
        │
        ▼
Evento: cliente criado
        │
        ▼
n8n
        │
        ├── envia e-mail
        ├── cria tarefa
        ├── agenda follow-up
        └── envia notificação
```

A criação do cliente continua sendo responsabilidade do backend.

---

# 15. Banco do n8n

O n8n utiliza:

```text
PostgreSQL
```

Banco:

```text
n8n
```

Isso separa os dados internos do n8n dos dados empresariais da aplicação.

Estrutura:

```text
PostgreSQL
├── agencia
└── n8n
```

---

# 16. Segurança de Portas

Atualmente:

```text
PostgreSQL
5432
somente rede Docker
```

```text
Redis
6379
somente rede Docker
```

```text
n8n
127.0.0.1:5678
```

PostgreSQL e Redis não devem ser publicados diretamente na internet.

Em produção, o acesso externo será realizado através de serviços apropriados como:

* Nginx
* HTTPS
* VPN
* SSH Tunnel

quando necessário.

---

# 17. Variáveis de Ambiente

Arquivo:

```text
.env
```

O arquivo pode conter:

* Senhas
* Chaves
* Tokens
* Configurações locais
* Credenciais

Exemplo:

```text
POSTGRES_PASSWORD
N8N_ENCRYPTION_KEY
```

O arquivo `.env` não deve ser versionado.

`.gitignore`:

```text
.env
```

---

# 18. Chave de Criptografia n8n

Variável:

```text
N8N_ENCRYPTION_KEY
```

Responsável por proteger credenciais armazenadas pelo n8n.

Essa chave deve permanecer estável.

Se ela for perdida, credenciais criptografadas armazenadas pelo n8n podem se tornar inutilizáveis.

Por isso ela deverá fazer parte da estratégia de backup seguro da infraestrutura.

---

# 19. Healthchecks

Healthchecks permitem ao Docker verificar se um serviço realmente está funcionando.

Não basta o processo estar executando.

PostgreSQL:

```text
pg_isready
```

Redis:

```text
redis-cli ping
```

Estado esperado:

```text
healthy
```

Verificar:

```bash
docker compose ps
```

---

# 20. Política de Restart

Os containers utilizam:

```text
restart: unless-stopped
```

Isso significa que o Docker tentará reiniciar automaticamente o serviço em caso de falha ou reinício do host.

Se o administrador parar manualmente o serviço, ele permanece parado.

---

# 21. Logs

Ver todos os logs:

```bash
docker compose logs
```

Últimas linhas:

```bash
docker compose logs --tail=100
```

Acompanhar em tempo real:

```bash
docker compose logs -f
```

Serviço específico:

```bash
docker compose logs -f postgres
```

```bash
docker compose logs -f redis
```

```bash
docker compose logs -f n8n
```

---

# 22. Volumes

Volumes atuais:

```text
postgres_data
redis_data
n8n_data
```

Visualizar:

```bash
docker volume ls
```

Os volumes pertencem ao Docker e não devem ser manipulados diretamente sem necessidade.

---

# 23. Futuro Backend

O backend será responsável pelas regras de negócio da agência.

Arquitetura prevista:

```text
Frontend
   │
   ▼
Backend API
   │
   ├── PostgreSQL
   ├── Redis
   ├── Workers
   ├── Agentes
   └── n8n
```

O backend será a camada central da aplicação.

---

# 24. Futuro Frontend

O frontend fornecerá a interface para:

* Dashboard
* CRM
* Clientes
* Projetos
* Financeiro
* Tarefas
* Suporte
* Agentes
* Aprovações
* Configurações

O frontend nunca deverá conectar diretamente ao PostgreSQL.

Fluxo correto:

```text
Frontend
   │
   ▼
API
   │
   ▼
PostgreSQL
```

---

# 25. Workers

Algumas tarefas não deverão executar diretamente dentro da requisição HTTP.

Exemplo:

```text
Usuário pede análise de 500 leads
```

Fluxo:

```text
Frontend
   │
   ▼
Backend
   │
   ▼
Cria Job
   │
   ▼
Redis
   │
   ▼
Worker
   │
   ▼
Agente IA
   │
   ▼
PostgreSQL
```

Isso evita travamento da API.

---

# 26. Agentes de IA

Os agentes serão componentes da aplicação.

Exemplos:

```text
Diretor
Comercial
Projetos
Financeiro
Marketing
Suporte
```

Cada agente possuirá:

* Instruções
* Permissões
* Ferramentas
* Contexto
* Limites
* Histórico
* Nível de autonomia

Os agentes não devem possuir acesso irrestrito à infraestrutura.

---

# 27. Separação entre IA e Dados

Princípio fundamental:

```text
IA não é banco de dados
```

A IA pode:

* Interpretar
* Resumir
* Recomendar
* Classificar
* Preparar ações
* Executar ferramentas autorizadas

PostgreSQL mantém o estado oficial da empresa.

---

# 28. Auditoria

Futuramente, toda ação importante deverá gerar registro.

Exemplos:

```text
agente criou tarefa
agente alterou lead
usuário aprovou proposta
workflow enviou mensagem
deploy executado
configuração alterada
```

A auditoria deverá registrar:

* usuário ou agente
* ação
* entidade afetada
* data/hora
* dados anteriores
* dados posteriores
* origem
* resultado

---

# 29. Backup

A infraestrutura deverá possuir backup para:

```text
PostgreSQL
n8n
arquivos importantes
configurações
```

O backup não deverá depender apenas dos volumes Docker.

Volume não é backup.

Fluxo correto:

```text
Volume
   │
   ▼
Backup
   │
   ▼
Armazenamento externo
```

---

# 30. Restore

Todo processo de backup deverá possuir procedimento de restauração documentado.

Regra:

```text
backup sem teste de restore
não é backup confiável
```

Os restores devem ser testados periodicamente em ambiente separado.

---

# 31. Ambiente de Desenvolvimento

Inicialmente:

```text
Debian local
```

Todos os componentes executam via Docker Compose.

---

# 32. Ambiente de Produção

No futuro, poderá utilizar:

```text
VPS / servidor Linux
```

Arquitetura semelhante ao ambiente local:

```text
Internet
   │
   ▼
Firewall
   │
   ▼
Nginx
   │
   ├── Frontend
   ├── Backend
   └── n8n
        │
        ▼
Docker Network
   │
   ├── PostgreSQL
   ├── Redis
   └── Workers
```

---

# 33. HTTPS

Em produção, nenhuma interface administrativa deverá trafegar sem HTTPS.

Fluxo:

```text
Internet
   │
   ▼
HTTPS :443
   │
   ▼
Nginx
   │
   ▼
Containers
```

Os containers internos podem continuar utilizando HTTP dentro da rede Docker.

---

# 34. Nginx

O Nginx será adicionado posteriormente.

Responsabilidades:

* Reverse proxy
* HTTPS
* Certificados SSL
* Roteamento
* Headers de segurança
* Limites de requisição
* Logs de acesso

---

# 35. CI/CD

Posteriormente será implementado processo automático de deploy.

Fluxo previsto:

```text
Git
   │
   ▼
Teste
   │
   ▼
Build
   │
   ▼
Imagem
   │
   ▼
Deploy
   │
   ▼
Healthcheck
```

---

# 36. Monitoramento

Futuramente deverão ser monitorados:

* CPU
* RAM
* Disco
* Containers
* PostgreSQL
* Redis
* Backend
* Jobs
* Erros
* Latência
* Backups
* Certificados
* Espaço em disco

---

# 37. Política de Atualizações

Nenhum serviço deve ser atualizado automaticamente sem validação.

Fluxo:

```text
Nova versão
   │
   ▼
Release Notes
   │
   ▼
Backup
   │
   ▼
Ambiente Local
   │
   ▼
Testes
   │
   ▼
Homologação
   │
   ▼
Produção
```

---

# 38. Política de Imagens Docker

Evitar:

```text
latest
```

Preferir:

```text
postgres:17.11-alpine
redis:7.4.11-alpine
n8nio/n8n:2.36.8
```

Isso garante maior previsibilidade.

---

# 39. Princípio de Menor Exposição

Um serviço só deve possuir porta publicada no host quando realmente precisar ser acessado externamente.

Exemplo:

```text
PostgreSQL
não precisa
```

```text
Redis
não precisa
```

```text
Backend
poderá precisar
```

```text
Frontend
poderá precisar
```

```text
Nginx
precisará
```

---

# 40. Princípio de Responsabilidade

Cada componente deve possuir uma função clara.

```text
PostgreSQL
→ dados persistentes

Redis
→ cache e filas

n8n
→ automação

Backend
→ regras de negócio

Frontend
→ interface

Workers
→ tarefas assíncronas

Agentes
→ inteligência

Nginx
→ entrada HTTP/HTTPS
```

Evitar concentrar todas as responsabilidades em um único serviço.

---

# 41. Arquitetura Futura

```text
                       INTERNET
                           │
                           ▼
                    ┌─────────────┐
                    │    NGINX    │
                    │    HTTPS    │
                    └──────┬──────┘
                           │
             ┌─────────────┴─────────────┐
             │                           │
             ▼                           ▼
      ┌─────────────┐             ┌─────────────┐
      │  Frontend   │             │   Backend   │
      │   Next.js   │             │     API     │
      └─────────────┘             └──────┬──────┘
                                         │
                     ┌───────────────────┼───────────────────┐
                     │                   │                   │
                     ▼                   ▼                   ▼
              ┌────────────┐      ┌────────────┐      ┌────────────┐
              │ PostgreSQL │      │   Redis    │      │    n8n     │
              └────────────┘      └──────┬─────┘      └────────────┘
                                         │
                                         ▼
                                  ┌─────────────┐
                                  │   Workers   │
                                  └──────┬──────┘
                                         │
                                         ▼
                                  ┌─────────────┐
                                  │ Agentes IA  │
                                  └─────────────┘
```

---

# 42. Diretriz Principal

A infraestrutura deve permanecer:

* Simples
* Segura
* Documentada
* Versionada
* Reproduzível
* Observável
* Recuperável
* Fácil de manter

A complexidade deverá ser adicionada apenas quando houver necessidade real.

Não adicionar Kubernetes, múltiplos clusters ou componentes distribuídos antes de existir demanda técnica que justifique essa evolução.
