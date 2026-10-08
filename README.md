# HCode Hub

Mini plataforma SaaS **modular e multi-tenant** construída com **NestJS + TypeScript + Prisma + PostgreSQL**.
Reúne, em um único monólito modular, gestão de organizações, CRM, cursos, agendamentos, faturamento, notificações e auditoria.

> Projeto de portfólio baseado no *Documento de Software — Especificação Funcional e Técnica v1.0*.
> Backend primeiro: o foco está nas regras de negócio, na modelagem relacional, no isolamento entre organizações (tenants), na segurança e na qualidade (testes + CI).

**Em uma frase:** monólito modular multi-tenant com NestJS + Prisma + PostgreSQL, isolamento de dados por organização validado por testes, Docker Compose reproduzível e CI com lint, testes e build.

---

## Sumário

1. [Objetivo](#objetivo)
2. [Arquitetura](#arquitetura)
3. [Módulos](#módulos)
4. [Stack](#stack)
5. [Requisitos](#requisitos)
6. [Como executar](#como-executar)
7. [Variáveis de ambiente](#variáveis-de-ambiente)
8. [Banco de dados](#banco-de-dados)
9. [Autenticação, multi-tenancy e RBAC](#autenticação-multi-tenancy-e-rbac)
10. [API REST](#api-rest)
11. [Validação (DTOs) e contrato de erros](#validação-dtos-e-contrato-de-erros)
12. [Regras de negócio](#regras-de-negócio)
13. [Swagger](#swagger)
14. [Testes](#testes)
15. [Docker](#docker)
16. [CI/CD](#cicd)
17. [Decisões técnicas](#decisões-técnicas)
18. [Limitações conhecidas](#limitações-conhecidas)
19. [Roadmap](#roadmap)
20. [Estrutura do repositório](#estrutura-do-repositório)

---

## Objetivo

Demonstrar domínio prático de backend:

- API REST com NestJS e TypeScript, organizada em módulos coesos;
- modelagem relacional e consultas em PostgreSQL, com integridade garantida **também no banco** (constraints, `CHECK`, exclusão de sobreposição, trigger de auditoria);
- regras de negócio com validações, transações e consistência (agendamento sem dupla reserva, pagamento idempotente, progresso de curso);
- **isolamento por organização (tenant)** em todas as áreas de negócio;
- suíte de testes (unitários, integração e E2E) que protege as regras mais importantes;
- execução reproduzível via Docker Compose e pipeline de CI no GitHub Actions.

**Critério de sucesso:** clonar o repositório, subir a API (`docker compose up -d`), abrir o Swagger, autenticar-se e exercitar os principais fluxos — sem nenhuma infraestrutura externa.

---

## Arquitetura

Monólito modular. Cada módulo expõe seus casos de uso por *services*; *controllers* só lidam com HTTP, *DTOs* com entrada/validação e o Prisma encapsula a persistência. Não há acoplamento direto entre módulos de negócio — apenas serviços transversais (auditoria e notificações) são compartilhados.

```
Cliente HTTP
   │
   ▼
NestJS / camada HTTP  (Helmet · CORS · ValidationPipe · filtro global de erros · requestId)
   │
   ├── Auth
   ├── Organizations / Users
   ├── CRM
   ├── Courses
   ├── Scheduling
   ├── Billing
   ├── Notifications  ┐ transversais
   └── Audit          ┘
          │
          ▼
     Prisma Client
          │
          ▼
      PostgreSQL
```

Fluxo de autorização de cada requisição:

```
Request
  ↓
JwtAuthGuard                  (valida o access token; carrega o usuário e checa status ACTIVE)
  ↓
OrganizationContextGuard      (resolve a organização e valida a Membership ativa)
  ↓
RolesGuard                    (RBAC — quando a rota declara @Roles)
  ↓
Controller → Service          (Prisma sempre filtrando por organizationId)
```

Princípios: baixo acoplamento e alta coesão; controllers sem regra de negócio; DTOs separados dos modelos persistidos; erros padronizados por filtro global; transações explícitas quando várias operações precisam ser atômicas; **nenhum recurso tenant-owned é buscado somente pelo ID** — sempre `id + organizationId`.

---

## Módulos

| Módulo | Escopo | Prioridade |
| --- | --- | --- |
| **Auth** | Cadastro (cria usuário + organização), login, refresh com rotação, logout, identidade atual | Alta |
| **Organizations / Users** | Organização, membros, papéis/status, perfil do usuário | Alta |
| **CRM** | Leads, etapas do funil, filtros, busca, paginação, histórico por auditoria | Alta |
| **Courses** | Cursos, módulos, aulas, matrícula e progresso | Alta |
| **Scheduling** | Disponibilidade, cálculo de horários livres, agendamento e cancelamento | Alta |
| **Billing** | Faturas, itens, desconto, pagamento simulado e webhook idempotente | Alta |
| **Notifications** | Notificações internas geradas por eventos de domínio | Média |
| **Audit** | Registro *append-only* de ações críticas | Média |
| **Health** | `GET /health` (API + banco) | — |

Fora do escopo da V1: gateway de pagamento real, envio de e-mail, armazenamento de vídeo, chat em tempo real, microserviços, Kubernetes, app mobile e Analytics (planejado para a V1.1).

---

## Stack

| Camada | Tecnologia |
| --- | --- |
| Runtime / linguagem | Node.js 22, TypeScript 5 |
| Framework | NestJS 11 (Express) |
| Banco | PostgreSQL 16 |
| ORM | Prisma 6 (client sem engine nativa + driver adapter `pg`) |
| Validação | `class-validator` + `class-transformer` (DTOs) |
| Autenticação | JWT (access) + refresh token rotativo, `bcrypt` |
| Segurança | Helmet, CORS por ambiente, rate limiting (`@nestjs/throttler`) |
| Documentação | Swagger / OpenAPI (`@nestjs/swagger`, com o plugin do Nest CLI) |
| Testes | Jest + Supertest |
| Qualidade | ESLint + Prettier |
| Infra | Docker, Docker Compose |
| CI | GitHub Actions |

---

## Requisitos

- **Docker** e **Docker Compose** (para o caminho mais simples);
- **Node.js 22+** e **npm** (para rodar a API localmente ou executar os testes).

---

## Como executar

### Opção A — Tudo no Docker (mais simples)

```bash
cp .env.example .env        # opcional: todas as variáveis têm valor padrão no compose
docker compose up -d --build
```

O serviço `api` espera o PostgreSQL ficar saudável, **aplica as migrations** (`prisma migrate deploy`) e popula os **dados de demonstração** (`RUN_SEED=true` por padrão no compose; defina `RUN_SEED=false` para desativar). Depois:

- API: <http://localhost:3000/api/v1>
- Swagger: <http://localhost:3000/docs>
- Health check: <http://localhost:3000/health>

### Opção B — Banco no Docker, API local (desenvolvimento)

```bash
docker compose up -d postgres      # só o PostgreSQL
npm install
cp .env.example .env
npx prisma migrate dev             # aplica as migrations
npm run prisma:seed                # dados de demonstração (opcional)
npm run start:dev                  # http://localhost:3000
```

### Dados de demonstração (seed)

O seed é idempotente e cria a organização **Demo Hub** (`slug: demo-hub`) com um usuário por papel — senha de todos: `Demo@12345`.

| Usuário | Papel |
| --- | --- |
| `owner@demo.hub` | OWNER |
| `admin@demo.hub` | ADMIN |
| `member@demo.hub` | MEMBER (com disponibilidade seg–sex, 09:00–18:00 UTC) |
| `student@demo.hub` | STUDENT (matriculado no curso publicado) |

Também cria o funil padrão, 3 leads, 1 curso publicado (2 módulos, 4 aulas), 1 curso em rascunho e 1 fatura pendente.

### Primeiros passos pela API

```bash
# 1. login
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@demo.hub","password":"Demo@12345"}'

# 2. usar o accessToken retornado
curl -s 'http://localhost:3000/api/v1/leads?limit=5' -H "Authorization: Bearer $TOKEN"

# 3. criar um lead (apêndice A.1 do documento)
curl -s -X POST http://localhost:3000/api/v1/leads \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Maria Silva","email":"maria@example.com","phone":"79999999999","source":"WEBSITE"}'
```

Ou crie uma conta nova: `POST /api/v1/auth/register` com `name`, `email`, `password` e `organizationName`.

### Scripts úteis

| Script | O que faz |
| --- | --- |
| `npm run start:dev` | API em modo watch |
| `npm run build` / `npm run start:prod` | Compila / executa a build |
| `npm run lint` · `npm run typecheck` · `npm run format` | Qualidade de código |
| `npm test` | Testes unitários |
| `npm run test:integration` | Testes de integração (PostgreSQL de teste) |
| `npm run test:e2e` | Testes E2E (PostgreSQL de teste) |
| `npm run test:all` | Todos os testes |
| `npm run prisma:migrate` · `npm run prisma:deploy` | Migrations (dev / deploy) |
| `npm run prisma:seed` | Seed de demonstração |
| `npm run db:up` · `npm run db:down` | Sobe / derruba o PostgreSQL do compose |
| `npm run db:test:up` · `npm run db:test:migrate` | Sobe e migra o banco de testes |

---

## Variáveis de ambiente

Validadas na inicialização (`src/config/env.validation.ts`): a API **não sobe** com configuração inválida.

| Variável | Exemplo / padrão | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | Sim | `development`, `test` ou `production` |
| `PORT` | `3000` | Sim | Porta HTTP |
| `DATABASE_URL` | `postgresql://hcode:hcode@localhost:5432/hcode_hub?schema=public` | Sim | Conexão PostgreSQL |
| `JWT_ACCESS_SECRET` | `change-me-access` | Sim | Segredo do access token — **troque em produção** |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Sim | Validade do access token |
| `JWT_REFRESH_SECRET` | `change-me-refresh` | Sim | Segredo do refresh token — **troque em produção** |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Sim | Validade do refresh token |
| `PAYMENT_WEBHOOK_SECRET` | `change-me-webhook` | Sim | Segredo do header `x-webhook-secret` |
| `CORS_ORIGINS` | `http://localhost:3001` | Não | Origens permitidas, separadas por vírgula (sem wildcard; vazio = CORS desligado) |
| `PAGINATION_MAX_LIMIT` | `100` | Não | Limite máximo de itens por página |
| `SWAGGER_ENABLED` | `true` | Não | Padrão: ligado fora de produção |
| `BCRYPT_ROUNDS` | `12` | Não | Custo do bcrypt |
| `AUTH_THROTTLE_TTL_SECONDS` / `AUTH_THROTTLE_LIMIT` | `60` / `10` | Não | Rate limiting dos endpoints de autenticação |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `hcode` / `hcode` / `hcode_hub` | Não | Credenciais do PostgreSQL no Compose |
| `TEST_DATABASE_URL` | `postgresql://hcode:hcode@localhost:5433/hcode_hub_test?schema=public` | Não | Banco usado pelos testes de integração/E2E |
| `RUN_MIGRATIONS` / `RUN_SEED` | `true` / `true` (compose) | Não | Comportamento do entrypoint da imagem Docker |

Segredos ficam **somente** em variáveis de ambiente; o `.env` está no `.gitignore`.

---

## Banco de dados

PostgreSQL com Prisma. O `schema.prisma` e as migrations (`prisma/migrations`) ficam versionados.

```mermaid
erDiagram
  Organization ||--o{ Membership : possui
  User ||--o{ Membership : participa
  User ||--o{ RefreshToken : sessoes
  Organization ||--o{ LeadStage : funil
  LeadStage ||--o{ Lead : contem
  Organization ||--o{ Course : oferece
  Course ||--o{ CourseModule : tem
  CourseModule ||--o{ Lesson : tem
  User ||--o{ Enrollment : matricula
  Course ||--o{ Enrollment : recebe
  Enrollment ||--o{ LessonProgress : registra
  Lesson ||--o{ LessonProgress : concluida
  Organization ||--o{ Availability : agenda
  Organization ||--o{ Appointment : agendamentos
  Organization ||--o{ Invoice : faturas
  Invoice ||--o{ InvoiceItem : itens
  Invoice ||--o{ Payment : pagamentos
  Organization ||--o{ Notification : avisos
  Organization ||--o{ AuditLog : auditoria
```

Decisão central: `User` **não** é ligado diretamente a `Organization`. Um usuário pode participar de várias organizações via `Membership` (que carrega o papel). Os dados operacionais carregam `organizationId` (direta ou indiretamente) e são sempre filtrados pelo contexto autenticado.

### Integridade garantida pelo próprio banco

Além das constraints do Prisma (`@unique`, FKs), a migration `integrity_constraints` adiciona o que o Prisma não expressa:

| Regra | Mecanismo |
| --- | --- |
| `Organization.slug`, `User.email` únicos | `UNIQUE` |
| `Membership(organizationId, userId)`, `Enrollment(courseId, userId)`, `LessonProgress(enrollmentId, lessonId)`, `LeadStage(organizationId, position)` únicos | `UNIQUE` composto |
| Sem sobreposição de agendamentos `CONFIRMED` do mesmo responsável | `EXCLUDE USING gist (ownerUserId WITH =, tsrange(startAt, endAt) WITH &&) WHERE status = 'CONFIRMED'` (extensão `btree_gist`) |
| `endAt > startAt`, `dayOfWeek` entre 0 e 6 | `CHECK` |
| `Invoice.total = subtotal − discount`, valores não negativos, `InvoiceItem.total = quantity × unitPrice`, `Payment.amount > 0` | `CHECK` |
| Webhook duplicado não cria pagamento duplicado | `Payment.externalId` `UNIQUE` |
| `AuditLog` somente inserção | *trigger* `BEFORE UPDATE` que bloqueia alterações |
| Valores monetários com precisão decimal | `DECIMAL(12,2)` + `Prisma.Decimal` no domínio |

### Índices

`users(email)`, `organizations(slug)`, `memberships(organizationId,userId)`, `leads(organizationId,stageId)`, `courses(organizationId,status)`, `appointments(organizationId,startAt,status)`, `invoices(organizationId,status)`, `notifications(userId,readAt)` e demais chaves estrangeiras de busca frequente.

### Migrations

```bash
npx prisma migrate dev      # desenvolvimento (cria/aplica)
npx prisma migrate deploy   # produção / CI / Docker
```

Há duas migrations: `init` (tabelas, enums, índices, FKs) e `integrity_constraints` (regras acima). Se alterar o `schema.prisma`, gere uma nova migration e **mantenha** a segunda intacta.

---

## Autenticação, multi-tenancy e RBAC

- **Access token** JWT de curta duração (padrão 15 min) + **refresh token** JWT de longa duração (padrão 7 dias).
- O refresh token é **rotativo**: cada `POST /auth/refresh` revoga o token usado e devolve um novo par. Reutilizar um token já revogado é tratado como possível roubo e **revoga todas as sessões** do usuário. No banco guarda-se apenas o **hash SHA-256** do refresh token.
- Senhas são armazenadas apenas com **bcrypt**. O login responde igual para usuário inexistente e senha incorreta (sem enumeração de usuários).
- **Contexto da organização:** vem do access token (organização escolhida no login) ou do header `x-organization-id` (troca de organização). Em ambos os casos é **validado contra uma `Membership` ativa** — o cliente nunca define o tenant por conta própria.
- Todo recurso tenant-owned é consultado por `id + organizationId`; recursos de outro tenant retornam **404**.

### Matriz de permissões

| Área | OWNER | ADMIN | MEMBER | STUDENT |
| --- | :-: | :-: | :-: | :-: |
| Atualizar organização, gerenciar membros | ✅ | — | — | — |
| Listar membros | ✅ | ✅ | — | — |
| CRM (leads) | ✅ | ✅ | ✅ | — |
| Criar etapas do funil | ✅ | ✅ | — | — |
| Criar/editar cursos | ✅ | ✅ | — | — |
| Ver cursos | ✅ todos | ✅ todos | ✅ todos | só `PUBLISHED` |
| Matricular-se / concluir aulas / ver o próprio progresso | ✅ | ✅ | ✅ | ✅ |
| Matricular outro usuário / ver progresso alheio | ✅ | ✅ | — | — |
| Agenda (disponibilidade e agendamentos) | ✅ | ✅ | ✅ (a própria disponibilidade) | — |
| Faturas e pagamentos | ✅ | ✅ | — | — |
| Notificações próprias, perfil | ✅ | ✅ | ✅ | ✅ |

---

## API REST

Base URL `/api/v1` (exceto `/health`). JSON, IDs UUID, datas ISO 8601 em UTC. Listagens aceitam `page`, `limit` (máx. configurável, padrão 100), `order` e filtros, e respondem `{ "data": [...], "meta": { "page", "limit", "total", "totalPages" } }`.

### Auth
| Método | Endpoint | Descrição |
| --- | --- | --- |
| POST | `/auth/register` | Cria usuário e organização inicial (vira OWNER) |
| POST | `/auth/login` | Autentica e retorna tokens (`organizationId` opcional) |
| POST | `/auth/refresh` | Renova o par de tokens (`organizationId` opcional para trocar de organização) |
| POST | `/auth/logout` | Revoga o refresh token (204) |
| GET | `/auth/me` | Identidade, organização ativa e todas as organizações do usuário |

> Os endpoints de Auth têm **rate limiting** (padrão: 10 requisições por 60 s por IP/rota → `429`).

### Organizations e Users
| Método | Endpoint | Descrição |
| --- | --- | --- |
| GET / PATCH | `/organizations/me` | Consulta / atualiza a organização (PATCH: OWNER) |
| GET / POST | `/organizations/me/members` | Lista (OWNER, ADMIN) / adiciona membro (OWNER) |
| PATCH / DELETE | `/organizations/me/members/:userId` | Atualiza papel/status / remove (OWNER; o OWNER não pode ser alterado) |
| GET / PATCH | `/users/me` | Perfil; PATCH altera nome e/ou senha (a troca de senha revoga as sessões) |

Ao adicionar um membro cujo e-mail ainda não existe, informe também `name` e `password`; se o usuário já existe, apenas `email` e `role`.

### CRM
| Método | Endpoint | Descrição |
| --- | --- | --- |
| POST | `/leads` | Cria lead (nome + ao menos e-mail ou telefone) |
| GET | `/leads` | Lista — filtros `search`, `stageId`, `status`, `source`, `sort` (`createdAt`/`updatedAt`/`name`), `order` |
| GET / PATCH | `/leads/:id` | Detalha / atualiza |
| DELETE | `/leads/:id` | Arquiva (exclusão lógica, 204) |
| PATCH | `/leads/:id/stage` | Move de etapa (gera `AuditLog`) |
| GET / POST | `/lead-stages` | Lista / cria etapa (POST: OWNER, ADMIN) |

### Courses
| Método | Endpoint | Descrição |
| --- | --- | --- |
| POST | `/courses` | Cria curso com módulos e aulas aninhados |
| GET | `/courses` · `/courses/:id` | Lista (filtros `search`, `status`) / detalha com módulos e aulas |
| PATCH | `/courses/:id` | Atualiza (inclui publicar/arquivar) |
| POST | `/courses/:id/enroll` | Cria matrícula (`userId` opcional para OWNER/ADMIN) |
| GET | `/courses/:id/progress` | Progresso: `{ courseId, completedLessons, totalLessons, percentage, completed }` |
| POST | `/courses/:id/lessons/:lessonId/complete` | Conclui a aula (idempotente) |
| GET | `/enrollments/me` | Matrículas do usuário com o progresso de cada curso |

### Scheduling
| Método | Endpoint | Descrição |
| --- | --- | --- |
| POST / GET | `/availability` | Cria / consulta janelas (`dayOfWeek` 0–6, `startTime`/`endTime` em `HH:mm` UTC) |
| GET | `/appointments/slots?date=YYYY-MM-DD&durationMinutes=60` | Horários livres de um responsável |
| POST | `/appointments` | Cria agendamento |
| GET | `/appointments` | Lista (filtros `ownerUserId`, `status`, `from`, `to`) |
| PATCH | `/appointments/:id/cancel` | Cancela (altera o status; o registro permanece) |

### Billing
| Método | Endpoint | Descrição |
| --- | --- | --- |
| POST | `/invoices` | Cria fatura `PENDING` com itens e desconto |
| GET | `/invoices` · `/invoices/:id` | Lista (filtros `status`, `search`, `from`, `to`) / detalha com itens e pagamentos |
| PATCH | `/invoices/:id/pay` | Registra pagamento simulado (`method` opcional) |
| POST | `/payments/webhook` | Evento de pagamento **idempotente** (header `x-webhook-secret`) |

Valores monetários são recebidos como número com no máximo 2 casas decimais e devolvidos como **string decimal** (ex.: `"291"`, `"0.3"`) para não perder precisão.

Exemplo de webhook:

```bash
curl -s -X POST http://localhost:3000/api/v1/payments/webhook \
  -H 'x-webhook-secret: change-me-webhook' -H 'Content-Type: application/json' \
  -d '{"eventId":"evt_123","invoiceId":"<uuid>","amount":291,"method":"PIX"}'
# 1ª entrega: {"received":true,"duplicate":false,"paymentId":"..."}
# reentrega:  {"received":true,"duplicate":true,"paymentId":"..."}   (mesmo pagamento, sem novo efeito)
```

### Notifications
| Método | Endpoint | Descrição |
| --- | --- | --- |
| GET | `/notifications` | Notificações do usuário na organização ativa (`unreadOnly`) |
| PATCH | `/notifications/:id/read` | Marca como lida |
| POST | `/notifications/read-all` | Marca todas como lidas |

Eventos que geram notificação: membro adicionado, matrícula criada, curso concluído, agendamento criado/cancelado por outra pessoa e fatura paga (para OWNER/ADMIN).

### Health
`GET /health` → `{ "status": "ok", "info": { "database": { "status": "up" } } }` (503 se o banco estiver indisponível).

---

## Validação (DTOs) e contrato de erros

Toda entrada passa por **DTOs com `class-validator` / `class-transformer`** antes de chegar às regras de negócio. O `ValidationPipe` global usa `whitelist` + `forbidNonWhitelisted` (campos desconhecidos são rejeitados) e `transform`. Entradas de texto são normalizadas (`trim`, e-mail em minúsculas). Os DTOs ficam em `src/modules/<módulo>/dto`.

Todos os erros seguem o mesmo contrato, com `requestId` (ULID) também presente nos logs e no header `x-request-id`:

```json
{
  "statusCode": 400,
  "error": "VALIDATION_ERROR",
  "message": "Dados inválidos",
  "details": [{ "field": "email", "message": "E-mail inválido" }],
  "requestId": "01J..."
}
```

| Código | HTTP | Uso |
| --- | :-: | --- |
| `VALIDATION_ERROR` | 400 | Payload inválido (`details` traz o caminho do campo, inclusive aninhado: `modules.0.title`) |
| `AUTHENTICATION_REQUIRED` | 401 | Token ausente/inválido, credenciais incorretas, assinatura de webhook inválida |
| `FORBIDDEN` | 403 | Sem permissão (papel ou organização) |
| `RESOURCE_NOT_FOUND` | 404 | Recurso inexistente **ou fora do tenant** |
| `CONFLICT` | 409 | Conflito de estado/unicidade/agendamento |
| `BUSINESS_RULE_VIOLATION` | 422 | Regra de negócio impede a operação |
| `TOO_MANY_REQUESTS` | 429 | Rate limiting |
| `INTERNAL_ERROR` | 500 | Falha inesperada (sem stack trace nem detalhes internos na resposta) |

---

## Regras de negócio

**Multi-tenancy** — toda entidade operacional tem `organizationId`; recursos nunca são buscados só pelo ID; auditoria e notificações também são do tenant.

**CRM** — lead exige nome e ao menos um canal de contato (e-mail validado / telefone com 8–15 dígitos); a etapa deve ser da mesma organização; mudança de etapa gera `AuditLog`; paginação com limite máximo configurável.

**Cursos** — só cursos `PUBLISHED` recebem matrícula; não há duas matrículas ativas para o mesmo curso (uma matrícula cancelada pode ser reativada); a aula só é concluída com matrícula válida; `progresso = aulas concluídas / total de aulas × 100`; curso sem aulas nunca gera progresso positivo; ao chegar a 100% a matrícula vira `COMPLETED` (uma única vez, mesmo sob concorrência) e o aluno é notificado.

**Agendamentos** — sem horários no passado; sem sobreposição com outro agendamento `CONFIRMED` do mesmo responsável (intervalos `[início, fim)`: horários encostados são permitidos); o intervalo precisa caber em uma janela de disponibilidade do mesmo dia (UTC); o cancelamento altera o status, nunca apaga o registro. A criação roda em **transação com `pg_advisory_xact_lock` por responsável**, e a constraint de exclusão do banco é a última linha de defesa contra dupla reserva.

**Financeiro** — a fatura nasce `PENDING`; só se paga fatura não cancelada; fatura paga não volta para `PENDING`; `total = Σ itens − desconto`, com `Decimal`; a transição `PENDING → PAID` é condicional (`updateMany ... WHERE status = 'PENDING'`), então pagamentos concorrentes não duplicam; o webhook é idempotente por `eventId` (`Payment.externalId` único), inclusive em entregas simultâneas.

---

## Swagger

Com `SWAGGER_ENABLED=true` (padrão fora de produção): <http://localhost:3000/docs> (JSON em `/docs-json`).

Cada endpoint tem resumo, parâmetros, corpo, códigos HTTP possíveis e indicação de autenticação. Os schemas dos DTOs são gerados pelo plugin do Nest CLI (`nest-cli.json`) a partir dos decorators do `class-validator` e dos comentários JSDoc. Para chamar rotas protegidas: faça login, clique em **Authorize** e informe o `accessToken`.

---

## Testes

```bash
docker compose --profile test up -d postgres-test    # banco isolado e descartável (porta 5433)
npm run db:test:migrate                               # aplica as migrations nele
npm test                                              # unitários (não precisam de banco)
npm run test:integration                              # Prisma + PostgreSQL
npm run test:e2e                                      # API completa via HTTP (Supertest)
```

Os testes de integração e E2E usam `TEST_DATABASE_URL` (padrão: `postgresql://hcode:hcode@localhost:5433/hcode_hub_test`) e criam dados com identificadores únicos, então não precisam limpar o banco entre execuções.

| Camada | O que cobre |
| --- | --- |
| **Unitários** | `AuthService` (hash, login, refresh, reuso de token), `CrmService`, cálculo de progresso, `CoursesService`, detecção de conflito e disponibilidade (`SchedulingService` + `slots.util`), cálculo de total e transições de status (`BillingService` + `invoice.util`), guards (tenant e RBAC), paginação |
| **Integração** | Criação de organização + membership numa transação, persistência de lead/etapas, matrícula + progresso, fatura + itens + pagamento, constraints do banco (exclusão de sobreposição, `CHECK`s, unicidades, trigger do `AuditLog`) |
| **E2E** | Registro → login → lead; curso → matrícula → progresso; disponibilidade → slot → agendamento → cancelamento (inclusive 6 requisições concorrentes); fatura → pagamento → webhook duplicado; isolamento entre tenants; RBAC; refresh/logout; rate limiting; contrato de erro; Swagger |

Casos de teste obrigatórios do documento (seção 11.4):

| ID | Cenário | Esperado | Onde está |
| --- | --- | --- | --- |
| T01 | Criar lead válido | 201 | `crm.e2e-spec` |
| T02 | Lead com e-mail inválido | 400 | `crm.e2e-spec` |
| T03 | Acessar lead de outro tenant | 404 | `tenant-rbac.e2e-spec`, `crm.service.spec`, `guards.spec` |
| T04 | Concluir aula sem matrícula | 403 | `courses.e2e-spec`, `courses.service.spec` |
| T05 | Progresso com 2 de 4 aulas | 50% | `courses.e2e-spec`, `progress.util.spec` |
| T06 | Agendar horário ocupado | 409 | `scheduling.e2e-spec`, `scheduling.service.spec`, `database.spec` |
| T07 | Agendar fora da disponibilidade | 409 | `scheduling.e2e-spec`, `scheduling.service.spec` |
| T08 | Pagar fatura já paga | 409 | `billing.e2e-spec`, `billing.service.spec` |
| T09 | Webhook duas vezes | um único pagamento | `billing.e2e-spec`, `billing.service.spec` |
| T10 | MEMBER tentando ação de OWNER | 403 | `tenant-rbac.e2e-spec`, `guards.spec` |

---

## Docker

```bash
docker compose up -d --build                  # postgres + api
docker compose up -d postgres                 # só o banco
docker compose --profile test up -d           # + banco de testes (5433)
docker compose --profile tools up -d          # + pgAdmin (http://localhost:5050)
docker compose logs -f api
docker compose down                           # para tudo (use -v para apagar os volumes)
```

| Serviço | Porta | Perfil | Finalidade |
| --- | --- | --- | --- |
| `postgres` | 5432 | padrão | PostgreSQL 16 (volume persistente, healthcheck) |
| `api` | 3000 | padrão | API NestJS — espera o banco, roda as migrations (e o seed) e sobe |
| `postgres-test` | 5433 | `test` | PostgreSQL efêmero (tmpfs) para integração/E2E |
| `pgadmin` | 5050 | `tools` | Interface web do PostgreSQL (login padrão `admin@hcode.dev` / `admin`; servidor: host `postgres`, porta `5432`) |

A imagem (`Dockerfile`) é *multi-stage*: compila a API e o seed, e a imagem final contém só dependências de produção (mais o Prisma CLI para `migrate deploy`), roda como usuário não-root e tem `HEALTHCHECK` em `/health`.

---

## CI/CD

`.github/workflows/ci.yml` roda em todo push na `main` e em Pull Requests:

```
Checkout → Node 22 → npm ci → Lint → TypeCheck
  → migrations em banco limpo → checagem de drift schema × migrations
  → testes unitários → integração → E2E → Build
  → (apenas na main) Docker build
```

Fluxo de branches: `main` (estável), `feature/*`, `fix/*`, `chore/*`. O template de Pull Request (`.github/pull_request_template.md`) pede problema, solução, testes executados e impactos no banco.

---

## Decisões técnicas

| Decisão | Justificativa |
| --- | --- |
| Monólito modular | Menos complexidade operacional; foco em fundamentos. Módulos com contratos claros podem ser extraídos depois. |
| PostgreSQL + Prisma | Relacionamentos, integridade e filtros fortes; schema e migrations explícitos. As regras críticas **também** existem no banco, sem esconder decisões atrás do ORM. |
| Prisma sem engine nativa (`engineType = "client"` + `@prisma/adapter-pg`) | Imagem mais leve e sem binário de query engine em runtime; usa o `pg` já conhecido. As migrations continuam usando o CLI do Prisma. |
| Tenant resolvido por `Membership` (guard) | O cliente nunca impõe o tenant; trocar de organização é um header validado. |
| Refresh token rotativo com detecção de reuso | Sessões revogáveis e mitigação de roubo de token; só o hash fica no banco. |
| Trava consultiva + constraint de exclusão | Evita dupla reserva sem serializar toda a tabela; o banco garante a invariante mesmo se a aplicação falhar. |
| `Decimal` no domínio, `DECIMAL(12,2)` no banco, string na resposta | Sem erro de ponto flutuante nem perda de precisão no JSON. |
| Webhook idempotente por chave única | Reentregas e entregas concorrentes são seguras. O segredo compartilhado é verificado com comparação em tempo constante. |
| `422` para `BUSINESS_RULE_VIOLATION` | O documento define o código de erro mas não o status; `422` separa regra de negócio (ex.: matrícula em curso não publicado) de conflito de estado (`409`). |
| Recurso de outro tenant → `404` | Não revela a existência do recurso (opção prevista no caso T03). |
| Arquivar lead (exclusão lógica) | Preserva histórico; `DELETE /leads/:id` marca como `ARCHIVED`. |

---

## Limitações conhecidas

- **Pagamento é simulado**; não há gateway real. O webhook valida um segredo compartilhado (não uma assinatura HMAC do provedor).
- Horários de disponibilidade e agendamento são em **UTC**; não há suporte a fusos por organização.
- Não há endpoint para cancelar fatura nem para editar módulos/aulas depois da criação do curso (a estrutura é definida na criação); o status `CANCELLED` da fatura existe e é respeitado pelas regras.
- Não há envio de e-mail, fila ou cache; notificações são apenas internas.
- O rate limiting usa armazenamento em memória (por instância).
- O módulo de **Analytics** (indicadores agregados do tenant) está planejado para a V1.1.
- Não há endpoint de leitura de auditoria; os registros ficam na tabela `audit_logs`.

---

## Roadmap

| Fase | Entrega | Status |
| --- | --- | --- |
| 1 | Bootstrap — NestJS, config, Prisma, PostgreSQL, Docker, lint | ✅ |
| 2 | Auth / tenant — registro, login, refresh, organização, RBAC | ✅ |
| 3 | CRM — leads, etapas, filtros, paginação, testes | ✅ |
| 4 | Courses — curso, módulos, aulas, matrícula, progresso | ✅ |
| 5 | Scheduling — disponibilidade, slots, conflito, cancelamento | ✅ |
| 6 | Billing — faturas, itens, pagamento, webhook idempotente | ✅ |
| 7 | Notifications / Audit — eventos críticos e histórico | ✅ |
| 8 | Qualidade — Swagger, E2E, CI, Docker, README | ✅ |
| 9 | Evolução | Cache Redis · fila BullMQ · pagamentos reais · e-mail transacional · storage S3 · relatórios/Analytics · webhooks de domínio · frontend Next.js · telemetria |

---

## Estrutura do repositório

```
src/
├── main.ts · app.module.ts · app.setup.ts
├── config/                 # validação das variáveis de ambiente
├── prisma/                 # PrismaService / PrismaModule
├── common/
│   ├── auth/               # decorators (@Public, @Roles, @Tenant...) e tipos
│   ├── guards/             # JwtAuthGuard, OrganizationContextGuard, RolesGuard
│   ├── errors/             # exceções, códigos, filtro global, ValidationPipe
│   ├── interceptors/       # log estruturado
│   ├── middleware/         # requestId
│   ├── pagination/         # DTO base + helpers
│   ├── database/           # transação / advisory lock
│   └── validation/         # transformers dos DTOs
└── modules/
    ├── auth/ organizations/ users/ crm/ courses/
    ├── scheduling/ billing/ notifications/ audit/ health/
    └── <módulo>/dto/       # DTOs com class-validator

prisma/
├── schema.prisma
├── migrations/             # init + integrity_constraints
└── seed.ts

test/
├── unit/  integration/  e2e/

Dockerfile · docker-compose.yml · docker-entrypoint.sh
.github/workflows/ci.yml · .github/pull_request_template.md
```

---

## Licença

[MIT](LICENSE)
