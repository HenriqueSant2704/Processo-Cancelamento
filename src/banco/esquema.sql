-- Estrutura do banco (Postgres / Neon). Pode rodar várias vezes: só cria o que falta.

create table if not exists processos (
  id               bigserial primary key,
  cliente_id       text not null,
  cliente_nome     text not null,
  cliente_contrato text,
  bloqueado_em     date not null,
  iniciado_em      date not null,
  status           text not null default 'ativo',      -- ativo | finalizado
  resultado        text,                               -- regularizado | cancelado
  etapa_atual      text,
  finalizado_em    date,
  versao           integer not null default 1,         -- evita que duas pessoas salvem por cima uma da outra
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

-- Um cliente só pode ter um processo ativo por vez.
create unique index if not exists processos_um_ativo_por_cliente on processos (cliente_id) where status = 'ativo';

create table if not exists tarefas (
  id            text primary key,                      -- "<processo>.<n>", ex.: 12.3
  processo_id   bigint not null references processos (id) on delete cascade,
  ordem         integer not null,
  etapa         text not null,
  tipo          text not null,                         -- contato | acao | decisao
  descricao     text not null,
  data          date not null,
  status        text not null default 'pendente',      -- pendente | concluida | cancelada
  concluida_em  date,
  concluida_por text,
  observacao    text,
  resposta      text,                                  -- sim | nao (só nas decisões)
  cancelada_em  date
);
create index if not exists tarefas_por_processo on tarefas (processo_id, ordem);
create index if not exists tarefas_pendentes_por_data on tarefas (data) where status = 'pendente';

create table if not exists historico (
  id            bigserial primary key,
  processo_id   bigint not null references processos (id) on delete cascade,
  data          date not null,
  registrado_em timestamptz not null default now(),
  por           text not null,
  evento        text not null,
  detalhes      text
);
create index if not exists historico_por_processo on historico (processo_id, id);

create table if not exists usuarios (
  id         bigserial primary key,
  login      text not null unique,
  nome       text not null,
  senha_hash text not null,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create table if not exists sessoes (
  token_hash text primary key,                         -- guardamos só o hash do token
  usuario_id bigint not null references usuarios (id) on delete cascade,
  expira_em  timestamptz not null
);

-- Primeiro dia em que o sistema viu cada contrato suspenso no SGP
-- (usado quando o SGP não informa a data da suspensão).
create table if not exists sgp_suspensoes (
  contrato_id   text primary key,
  visto_desde   date not null,
  atualizado_em timestamptz not null default now()
);

-- Valor em aberto do contrato (atualizado a cada sincronização com o SGP).
alter table processos add column if not exists valor_aberto numeric(12, 2);
alter table processos add column if not exists faturas_abertas integer;
alter table processos add column if not exists financeiro_em date;

-- Fluxo do processo (principal = suspensos; pos-cancelamento = ocorrências de negativação pós-cancelamento)
-- e a ocorrência do SGP que originou o processo.
alter table processos add column if not exists fluxo text not null default 'principal';
alter table processos add column if not exists ocorrencia_numero text;

-- Username do funcionário no SGP (aparece como quem abriu a ocorrência criada pelo sistema).
alter table usuarios add column if not exists sgp_login text;

-- Promessa de pagamento: nas decisões "o cliente pagou?", guarda qual aviso volta se ele não pagar.
alter table tarefas add column if not exists promessa integer;

-- Aviso na ocorrência já enviado para esta tarefa (ex.: "abrir OS de retirada").
alter table tarefas add column if not exists avisado_em date;

-- Ficha do cliente vinda do SGP (CPF, contatos, plano, faturas, frequência de atraso), por contrato.
-- Atualizada a cada sincronização; só para os contratos com processo ativo.
create table if not exists fichas_clientes (
  contrato_id   text primary key,
  dados         jsonb not null,
  atualizado_em date not null
);

-- Autorização do supervisor entre etapas (aguardando / autorizado / negado / respondido, texto da resposta, visto).
alter table processos add column if not exists autorizacao jsonb;

-- Prints que comprovam cada aviso (imagem guardada aqui; enviado_sgp_em = quando foi anexado na ocorrência).
create table if not exists anexos (
  id             serial primary key,
  processo_id    text not null,
  tarefa_id      text,
  nome           text not null,
  tipo           text not null,
  tamanho        integer not null,
  dados          bytea not null,
  criado_em      date not null,
  criado_por     text,
  enviado_sgp_em date
);
create index if not exists anexos_processo on anexos (processo_id);

-- Aviso enviado e esperando o retorno do cliente: { enviadoEm, enviadoPor, proximaChecagem, checagens: [{ em, por, resultado, texto }] }.
alter table tarefas add column if not exists retorno jsonb;
