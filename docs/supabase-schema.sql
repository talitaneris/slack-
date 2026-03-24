-- ================================================================
-- Schema Supabase — Squad TNeris Bot
-- Cole esse script no SQL Editor do Supabase e execute.
-- ================================================================

-- 1. Memória acumulada por agente
create table if not exists agent_memory (
  agent_key  text primary key,
  content    text    not null default '',
  updated_at timestamptz not null default now()
);

-- 2. Tasks abertas por agente
create table if not exists agent_tasks (
  id         bigserial primary key,
  agent_key  text        not null,
  task       text        not null,
  created_at timestamptz not null default now()
);
create index if not exists agent_tasks_agent_key_idx on agent_tasks(agent_key);

-- 3. Aprovações aguardando resposta de Talita
create table if not exists aprovacoes_pendentes (
  message_ts text primary key,  -- ts da mensagem no Slack
  agent_key  text        not null,
  content    text        not null,
  saved_at   timestamptz not null default now()
);

-- 4. Fila inter-agente
create table if not exists inter_agent_queue (
  id         text primary key,
  from_agent text        not null,
  to_agent   text        not null,
  command    text        not null,
  payload    jsonb       not null default '{}',
  status     text        not null default 'pending', -- pending | processing | done | error
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  result     jsonb
);
create index if not exists queue_to_agent_status_idx on inter_agent_queue(to_agent, status);

-- ================================================================
-- RLS (Row Level Security) — desabilitar para service_role
-- O bot usa SUPABASE_SERVICE_KEY que bypassa RLS por padrão.
-- Se quiser segurança extra, habilite RLS e crie policies.
-- ================================================================
-- alter table agent_memory         enable row level security;
-- alter table agent_tasks          enable row level security;
-- alter table aprovacoes_pendentes enable row level security;
-- alter table inter_agent_queue    enable row level security;
