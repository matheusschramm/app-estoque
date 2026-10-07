-- =============================================================
-- SISTEMA DE CONTROLE DE ESTOQUE
-- Supabase / PostgreSQL
-- Schema normalizado (1FN, 2FN, 3FN)
--
-- Script de criação de banco de PRODUÇÃO. Popula apenas dados de
-- referência (seção 19) e o admin inicial (seção 20). Locais,
-- produtos e estoques ficam vazios, para serem cadastrados pelo app.
-- Para um banco de testes com dados fictícios, rode `seed_demo.sql`
-- depois deste.
-- =============================================================

-- -------------------------------------------------------------
-- 1. PAPÉIS (ROLES)
--    Tabela normalizada de cargos/funções dos usuários.
--    Obs: "Admin" foi removido daqui — administração é controlada
--    pelo flag is_admin em perfis (campo técnico de sistema).
-- -------------------------------------------------------------
create table papeis (
  id          serial      primary key,
  nome        text        not null unique,
  descricao   text,
  criado_em   timestamptz not null default now()
);

comment on table  papeis      is 'Cargos/funções operacionais: Almoxarife, Cozinheiro, etc. Não inclui "Admin" — administração é controlada pelo flag is_admin em perfis.';
comment on column papeis.nome is 'Nome único do papel — evita duplicatas e variações de escrita.';

-- -------------------------------------------------------------
-- 2. PERFIS
--    Extensão da tabela auth.users do Supabase.
--    Criado automaticamente via trigger quando um usuário
--    se cadastra. Guarda dados extras como nome, papel e flag admin.
--    is_admin é flag técnico de sistema, independente do papel operacional.
-- -------------------------------------------------------------
create table perfis (
  id            uuid        primary key,
  nome          text        not null,
  papel_id      int,
  is_admin      boolean     not null default false,
  ativo         boolean     not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint perfis_id_fk
    foreign key (id) references auth.users(id) on delete cascade,

  constraint perfis_papel_id_fk
    foreign key (papel_id) references papeis(id) on delete set null
);

comment on table  perfis          is 'Dados extras do usuário; espelha auth.users via trigger.';
comment on column perfis.id       is 'Mesmo UUID do auth.users — não é gerado aqui.';
comment on column perfis.papel_id is 'FK para papeis — cargo/função operacional do usuário.';
comment on column perfis.is_admin is 'Flag técnico de sistema. Se true, o usuário pode gerenciar perfis, papéis e dados mestres. Independente do papel operacional.';
comment on column perfis.ativo    is 'Se false, o usuário não pode realizar operações no sistema.';

-- Trigger: cria o perfil automaticamente ao criar usuário no Supabase Auth
create or replace function fn_cria_perfil()
returns trigger language plpgsql security definer as $$
begin
  insert into public.perfis (id, nome)
  values (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'nome', NEW.email)
  );
  return NEW;
end;
$$;

create trigger tg_cria_perfil
after insert on auth.users
for each row execute function fn_cria_perfil();

-- -------------------------------------------------------------
-- 3. CATEGORIAS
--    Tabela normalizada de categorias de produtos.
-- -------------------------------------------------------------
create table categorias (
  id          serial      primary key,
  nome        text        not null unique,
  descricao   text
);

comment on table  categorias      is 'Categorias de produtos: Limpeza, Alimentação, Escritório, etc.';
comment on column categorias.nome is 'Nome único da categoria — evita duplicatas e variações de escrita.';

-- -------------------------------------------------------------
-- 4. UNIDADES  [NOVO]
--    Normaliza as unidades de medida que antes eram texto livre
--    em apresentacoes.unidade. Garante consistência e evita
--    variações como "L", "l", "litro", "Litro".
-- -------------------------------------------------------------
create table unidades (
  id    serial primary key,
  sigla text   not null unique,
  nome  text
);

comment on table  unidades       is 'Unidades de medida: L, ml, kg, g, un, etc.';
comment on column unidades.sigla is 'Sigla única — usada como referência em apresentacoes.';
comment on column unidades.nome  is 'Nome completo da unidade: Litro, Mililitro, Quilograma, etc.';

-- -------------------------------------------------------------
-- 5. PRODUTOS
--    Representa o item genérico (ex: "Água Sanitária")
-- -------------------------------------------------------------
create table produtos (
  id            serial      primary key,
  nome          text        not null unique,
  categoria_id  int,
  criado_por    uuid,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint produtos_categoria_id_fk
    foreign key (categoria_id) references categorias(id) on delete set null,

  constraint produtos_criado_por_fk
    foreign key (criado_por) references auth.users(id) on delete set null
);

comment on table  produtos              is 'Produto genérico, independente de embalagem ou tamanho.';
comment on column produtos.categoria_id is 'FK para categorias — agrupamento do produto.';
comment on column produtos.criado_por   is 'Usuário que cadastrou o produto.';

-- -------------------------------------------------------------
-- 6. APRESENTAÇÕES
--    Cada variação de embalagem/tamanho de um produto.
--    Ex: Água Sanitária 2L, Água Sanitária 5L.
--    unidade_id substitui o antigo campo texto livre "unidade".
-- -------------------------------------------------------------
create table apresentacoes (
  id                  serial        primary key,
  produto_id          int           not null,
  descricao           text          not null,
  quantidade_unitaria numeric(10,4) not null,
  unidade_id          int           not null,
  criado_por          uuid,
  criado_em           timestamptz   not null default now(),
  atualizado_em       timestamptz   not null default now(),

  constraint apresentacoes_quantidade_positiva
    check (quantidade_unitaria > 0),

  constraint apresentacoes_produto_id_fk
    foreign key (produto_id) references produtos(id) on delete cascade,

  constraint apresentacoes_unidade_id_fk
    foreign key (unidade_id) references unidades(id) on delete restrict,

  constraint apresentacoes_criado_por_fk
    foreign key (criado_por) references auth.users(id) on delete set null
);

comment on table  apresentacoes                    is 'Variações de embalagem/tamanho de um produto.';
comment on column apresentacoes.quantidade_unitaria is 'Quanto esta embalagem contém, na unidade base do produto.';
comment on column apresentacoes.unidade_id          is 'FK para unidades — substitui o antigo campo texto livre.';
comment on column apresentacoes.criado_por          is 'Usuário que cadastrou a apresentação.';

-- -------------------------------------------------------------
-- 7. LOCAIS
--    Locais físicos de armazenamento (almoxarifado, cozinha…)
-- -------------------------------------------------------------
create table locais (
  id          serial      primary key,
  nome        text        not null unique,
  descricao   text,
  ativo       boolean     not null default true,
  criado_por  uuid,
  criado_em   timestamptz not null default now(),

  constraint locais_criado_por_fk
    foreign key (criado_por) references auth.users(id) on delete set null
);

comment on table locais is 'Locais físicos onde o estoque é mantido.';

-- -------------------------------------------------------------
-- 7.1 USUARIOS_LOCAIS
--     Quais locais cada usuário acessa e se pode gerenciar.
--     Admin não entra aqui — fn_is_admin() concede acesso total.
-- -------------------------------------------------------------
create table usuarios_locais (
  usuario_id  uuid        not null,
  local_id    int         not null,
  pode_editar boolean     not null default false,
  criado_em   timestamptz not null default now(),
  criado_por  uuid,

  constraint usuarios_locais_pk
    primary key (usuario_id, local_id),

  constraint usuarios_locais_usuario_fk
    foreign key (usuario_id) references perfis(id) on delete cascade,

  constraint usuarios_locais_local_fk
    foreign key (local_id) references locais(id) on delete cascade,

  constraint usuarios_locais_criado_por_fk
    foreign key (criado_por) references perfis(id) on delete set null
);

create index idx_usuarios_locais_local on usuarios_locais(local_id);

comment on table  usuarios_locais             is 'Quais locais cada usuário acessa e se pode gerenciar o estoque deles. Administradores não precisam de linhas aqui — fn_is_admin() concede acesso total.';
comment on column usuarios_locais.pode_editar is 'false = somente leitura (visualizador). true = pode movimentar estoque e editar o mínimo neste local.';
comment on column usuarios_locais.criado_por  is 'Admin que concedeu o acesso. Null quando veio da migração inicial.';

-- -------------------------------------------------------------
-- 8. ESTOQUES
--    Combinação apresentação × local; guarda quantidade atual
-- -------------------------------------------------------------
create table estoques (
  id               serial        primary key,
  apresentacao_id  int           not null,
  local_id         int           not null,
  quantidade_atual numeric(12,4) not null default 0,
  estoque_minimo   numeric(12,4) not null default 0,
  criado_em        timestamptz   not null default now(),
  atualizado_em    timestamptz   not null default now(),

  constraint estoques_combinacao_unica
    unique (apresentacao_id, local_id),

  constraint estoques_quantidade_nao_negativa
    check (quantidade_atual >= 0),

  constraint estoques_minimo_nao_negativo
    check (estoque_minimo >= 0),

  constraint estoques_apresentacao_id_fk
    foreign key (apresentacao_id) references apresentacoes(id) on delete restrict,

  constraint estoques_local_id_fk
    foreign key (local_id) references locais(id) on delete restrict
);

comment on table  estoques                  is 'Saldo atual de cada apresentação em cada local.';
comment on column estoques.quantidade_atual is 'Cache atualizado via trigger a cada movimentação.';
comment on column estoques.estoque_minimo   is 'Quantidade mínima desejada (em embalagens). Usada no alerta de estoque baixo e na sugestão de compra.';

-- -------------------------------------------------------------
-- 9. MOTIVOS DE MOVIMENTAÇÃO  [NOVO]
--    Normaliza o campo "motivo" que antes era texto livre em
--    movimentacoes. Garante consistência e permite que a lógica
--    de negócio (ex: excluir descartes do consumo) seja baseada
--    em IDs, não em strings comparadas manualmente.
-- -------------------------------------------------------------
create table motivos_movimentacao (
  id        serial  primary key,
  codigo    text    not null unique,
  descricao text    not null
);

comment on table  motivos_movimentacao        is 'Motivos possíveis para movimentações de estoque.';
comment on column motivos_movimentacao.codigo is 'Código curto único: uso, descarte, compra, ajuste, outro. Usado em lógicas de negócio.';

-- -------------------------------------------------------------
-- 10. MOVIMENTAÇÕES
--     Registro imutável de cada entrada ou saída.
--     motivo_id substitui o antigo campo texto livre "motivo".
-- -------------------------------------------------------------
create type tipo_movimentacao as enum ('entrada', 'saida');

create table movimentacoes (
  id          serial            primary key,
  estoque_id  int               not null,
  criado_por  uuid              not null,
  tipo        tipo_movimentacao not null,
  quantidade  numeric(12,4)     not null,
  motivo_id   int,
  data        timestamptz       not null default now(),
  criado_em   timestamptz       not null default now(),

  constraint movimentacoes_quantidade_positiva
    check (quantidade > 0),

  constraint movimentacoes_estoque_id_fk
    foreign key (estoque_id) references estoques(id) on delete restrict,

  constraint movimentacoes_criado_por_fk
    foreign key (criado_por) references auth.users(id) on delete restrict,

  constraint movimentacoes_motivo_id_fk
    foreign key (motivo_id) references motivos_movimentacao(id) on delete set null
);

comment on table  movimentacoes            is 'Registro imutável de entradas e saídas de estoque.';
comment on column movimentacoes.criado_por is 'Usuário responsável pela movimentação — obrigatório.';
comment on column movimentacoes.motivo_id  is 'FK para motivos_movimentacao — substitui o antigo campo texto livre.';
comment on column movimentacoes.data       is 'Data/hora do evento real (pode diferir de criado_em).';

-- -------------------------------------------------------------
-- 11. TRIGGER — atualiza quantidade_atual em estoques
--     automaticamente após cada movimentação inserida
-- -------------------------------------------------------------
-- security definer: o update em estoques precisa ignorar o RLS
-- (não há policy de UPDATE em estoques para usuários comuns — de
-- propósito, o saldo só muda via movimentação).
create or replace function fn_atualiza_estoque()
returns trigger language plpgsql security definer as $$
begin
  if NEW.tipo = 'entrada' then
    update estoques
       set quantidade_atual = quantidade_atual + NEW.quantidade,
           atualizado_em    = now()
     where id = NEW.estoque_id;
  else
    update estoques
       set quantidade_atual = quantidade_atual - NEW.quantidade,
           atualizado_em    = now()
     where id = NEW.estoque_id;
  end if;
  return NEW;
end;
$$;

create trigger tg_atualiza_estoque
after insert on movimentacoes
for each row execute function fn_atualiza_estoque();

-- -------------------------------------------------------------
-- 11.1 TRIGGER — devolve o saldo quando a movimentação é excluída
--      Espelho do trigger acima. Fica num trigger, e não numa RPC,
--      para que qualquer caminho que apague uma movimentação devolva
--      o saldo — inclusive um delete manual no SQL Editor. Só admin
--      chega aqui (ver a policy de delete na seção 17).
-- -------------------------------------------------------------
create or replace function fn_reverte_estoque()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_saldo numeric;
  v_novo  numeric;
begin
  -- for update trava a linha do estoque até o fim da transação. Sem a trava,
  -- uma movimentação registrada em paralelo entraria entre esta leitura e o
  -- update abaixo, e o valor absoluto gravado aqui apagaria o efeito dela.
  select quantidade_atual into v_saldo
    from estoques
   where id = OLD.estoque_id
     for update;

  if not found then
    return OLD;   -- estoque já removido na mesma transação; nada a devolver
  end if;

  v_novo := case OLD.tipo
              when 'entrada' then v_saldo - OLD.quantidade
              else                v_saldo + OLD.quantidade
            end;

  -- Entrada de 10, saída de 8, e alguém exclui a entrada: o saldo iria a -8.
  -- Recusar é o certo — se aquela entrada nunca existiu, a saída também não
  -- poderia ter acontecido, e adivinhar qual dos dois corrigir não é trabalho
  -- do banco. O ajuste de contagem física resolve sem apagar histórico.
  if v_novo < 0 then
    raise exception
      'Excluir esta movimentação deixaria o saldo em %. Houve movimentações posteriores que dependem dela — corrija com um ajuste de contagem física em vez de excluir.',
      v_novo
      using errcode = '23514';
  end if;

  update estoques
     set quantidade_atual = v_novo,
         atualizado_em    = now()
   where id = OLD.estoque_id;

  return OLD;
end;
$$;

create trigger tg_reverte_estoque
after delete on movimentacoes
for each row execute function fn_reverte_estoque();

comment on function fn_reverte_estoque() is
  'Devolve ao estoque o efeito de uma movimentação excluída: entrada subtrai, saída soma. Espelho de fn_atualiza_estoque. Recusa a exclusão se o saldo ficaria negativo.';

-- -------------------------------------------------------------
-- 12. VIEW — consumo por produto nos últimos 30 dias
--     Ajustada para usar motivo_id em vez de texto livre.
--     Os códigos 'descarte' e 'ajuste' são filtrados via join na
--     tabela motivos: descarte não é consumo real, e ajuste é uma
--     correção de contagem (não demanda) — contá-los inflacionaria
--     a sugestão de compra sem relação com consumo de fato.
-- -------------------------------------------------------------
-- Consolida por produto × local × unidade: apresentações diferentes do
-- mesmo produto (ex: pacote 500g e pacote 1kg) somam na unidade base.
-- Parte de "estoques" (não de movimentações) para que produtos sem
-- consumo recente também apareçam, com consumo = 0.
-- Obs: apresentações do mesmo produto com unidades diferentes (ex: g e kg)
-- geram linhas separadas — cadastre sempre na mesma unidade base.
create or replace view vw_consumo_30_dias as
with consumo as (
  select
    e.local_id,
    a.produto_id,
    a.unidade_id,
    sum(m.quantidade * a.quantidade_unitaria) as consumo_base
  from movimentacoes m
  join estoques      e  on e.id = m.estoque_id
  join apresentacoes a  on a.id = e.apresentacao_id
  left join motivos_movimentacao mo on mo.id = m.motivo_id
  where m.tipo  = 'saida'
    and (mo.codigo is null or mo.codigo not in ('descarte', 'ajuste'))
    and m.data >= now() - interval '30 days'
  group by e.local_id, a.produto_id, a.unidade_id
),
saldo as (
  select
    e.local_id,
    a.produto_id,
    a.unidade_id,
    sum(e.quantidade_atual)                         as embalagens,
    sum(e.quantidade_atual * a.quantidade_unitaria) as estoque_base,
    sum(e.estoque_minimo   * a.quantidade_unitaria) as minimo_base
  from estoques      e
  join apresentacoes a on a.id = e.apresentacao_id
  group by e.local_id, a.produto_id, a.unidade_id
)
select
  p.id                                   as produto_id,
  p.nome                                 as produto,
  c.nome                                 as categoria,
  u.sigla                                as unidade,
  l.id                                   as local_id,
  l.nome                                 as local,
  round(coalesce(co.consumo_base, 0), 4) as consumo_total_unidade_base,
  s.embalagens                           as estoque_atual_unidades,
  round(s.estoque_base, 4)               as estoque_atual_unidade_base,
  round(s.minimo_base, 4)                as estoque_minimo_unidade_base
from saldo s
join produtos        p on p.id = s.produto_id
left join categorias c on c.id = p.categoria_id
join locais          l on l.id = s.local_id
join unidades        u on u.id = s.unidade_id
left join consumo   co on co.produto_id = s.produto_id
                      and co.local_id   = s.local_id
                      and co.unidade_id = s.unidade_id;

-- security_invoker: sem isto a view roda com a permissão do dono e
-- ignora o RLS das tabelas-base, devolvendo todos os locais.
alter view vw_consumo_30_dias set (security_invoker = on);

comment on view vw_consumo_30_dias is
  'Consumo real (excluindo descartes e ajustes de inventário) dos últimos 30 dias, consolidado por produto, local e unidade base. Inclui produtos sem consumo recente.';

-- -------------------------------------------------------------
-- 13. VIEW — sugestão de compra para o próximo mês
-- -------------------------------------------------------------
create or replace view vw_sugestao_compra as
select
  produto_id,
  produto,
  categoria,
  local_id,
  local,
  unidade,
  consumo_total_unidade_base               as consumo_30_dias,
  estoque_atual_unidade_base               as estoque_atual,
  greatest(
    consumo_total_unidade_base
      + estoque_minimo_unidade_base
      - estoque_atual_unidade_base,
    0
  )                                        as quantidade_sugerida_compra,
  estoque_minimo_unidade_base              as estoque_minimo
from vw_consumo_30_dias;

-- security_invoker: sem isto a view roda com a permissão do dono e
-- ignora o RLS das tabelas-base, devolvendo todos os locais.
alter view vw_sugestao_compra set (security_invoker = on);

comment on view vw_sugestao_compra is
  'Sugestão de compra = consumo 30 dias + estoque mínimo − estoque atual (nunca negativo).';

-- -------------------------------------------------------------
-- 14. VIEW — auditoria de movimentações com nome do usuário
-- -------------------------------------------------------------
-- unaccent é usado na coluna "busca" abaixo. Fica no schema extensions,
-- onde a Supabase mantém as demais (pgcrypto, usado na seção 20).
create extension if not exists unaccent with schema extensions;

create or replace view vw_auditoria_movimentacoes as
select
  m.id,
  m.data,
  m.tipo,
  m.quantidade,
  a.quantidade_unitaria,
  u.sigla                                  as unidade,
  mo.codigo                                as motivo,
  mo.descricao                             as motivo_descricao,
  p.nome                                   as produto,
  a.descricao                              as apresentacao,
  l.id                                     as local_id,
  l.nome                                   as local,
  pf.nome                                  as usuario,
  pa.nome                                  as cargo_usuario,
  pf.is_admin                              as usuario_admin,
  -- Coluna de busca da tela de Histórico: os campos que ela pesquisa,
  -- concatenados, sem acento e em maiúsculas. Existe porque o ilike do
  -- Postgres não ignora acento ('acucar' ilike '%AÇÚCAR%' é falso) e a tela
  -- filtra no servidor, já que pagina de 20 em 20. O unaccent daqui e o
  -- normalizar() do JavaScript chegam ao mesmo resultado para as letras do
  -- português, que é o que mantém as duas pontas da busca de acordo.
  -- Sem índice de propósito: unaccent é STABLE, não IMMUTABLE, então indexar
  -- exigiria um wrapper imutável — não paga para o volume desta base.
  upper(extensions.unaccent(
    coalesce(p.nome, '') || ' ' ||
    coalesce(a.descricao, '') || ' ' ||
    coalesce(pf.nome, '')
  ))                                       as busca
from movimentacoes            m
join estoques                 e  on e.id  = m.estoque_id
join apresentacoes            a  on a.id  = e.apresentacao_id
join unidades                 u  on u.id  = a.unidade_id
join produtos                 p  on p.id  = a.produto_id
join locais                   l  on l.id  = e.local_id
join perfis                   pf on pf.id = m.criado_por
left join papeis              pa on pa.id = pf.papel_id
left join motivos_movimentacao mo on mo.id = m.motivo_id
order by m.data desc;

-- security_invoker: sem isto a view roda com a permissão do dono e
-- ignora o RLS das tabelas-base, devolvendo todos os locais.
alter view vw_auditoria_movimentacoes set (security_invoker = on);

comment on view vw_auditoria_movimentacoes is
  'Histórico completo de movimentações com produto, local e usuário responsável. A coluna busca concatena produto, apresentação e usuário sem acento, para o filtro de texto da tela.';

-- -------------------------------------------------------------
-- 15. ÍNDICES — performance em consultas comuns
-- -------------------------------------------------------------
create index idx_movimentacoes_estoque_data on movimentacoes(estoque_id, data desc);
create index idx_movimentacoes_tipo_data    on movimentacoes(tipo, data desc);
create index idx_movimentacoes_criado_por   on movimentacoes(criado_por);
create index idx_movimentacoes_motivo_id    on movimentacoes(motivo_id);
create index idx_estoques_apresentacao      on estoques(apresentacao_id);
create index idx_estoques_local             on estoques(local_id);
create index idx_apresentacoes_produto      on apresentacoes(produto_id);
create index idx_apresentacoes_unidade      on apresentacoes(unidade_id);

-- Índice funcional, e não constraint, para ignorar caixa e espaços nas pontas:
-- "Pacote 5kg", "PACOTE 5KG" e "Pacote 5kg " passam a colidir.
create unique index idx_apresentacoes_descricao_unica
  on apresentacoes (produto_id, lower(trim(descricao)));

comment on index idx_apresentacoes_descricao_unica is
  'Impede duas apresentações com a mesma descrição no mesmo produto, ignorando caixa e espaços nas pontas.';
create index idx_perfis_papel               on perfis(papel_id);
create index idx_produtos_categoria         on produtos(categoria_id);

-- -------------------------------------------------------------
-- 16. FUNÇÕES AUXILIARES PARA RLS
-- -------------------------------------------------------------
create or replace function fn_is_admin()
returns boolean language sql security definer stable as $$
  select coalesce(
    (select is_admin from perfis where id = auth.uid()),
    false
  );
$$;

create or replace function fn_is_ativo()
returns boolean language sql security definer stable as $$
  select coalesce(
    (select ativo from perfis where id = auth.uid()),
    false
  );
$$;

comment on function fn_is_admin() is 'Retorna true se o usuário logado é administrador.';
comment on function fn_is_ativo() is 'Retorna true se o usuário logado está ativo no sistema.';

-- Acesso por local. As três são security definer de propósito: precisam
-- ler usuarios_locais ignorando o RLS da própria tabela, senão a checagem
-- entraria em recursão.
create or replace function fn_pode_ver_local(p_local_id int)
returns boolean language sql security definer stable as $$
  select fn_is_ativo() and (
    fn_is_admin() or exists (
      select 1 from usuarios_locais
      where usuario_id = auth.uid()
        and local_id   = p_local_id
    )
  );
$$;

create or replace function fn_pode_editar_local(p_local_id int)
returns boolean language sql security definer stable as $$
  select fn_is_ativo() and (
    fn_is_admin() or exists (
      select 1 from usuarios_locais
      where usuario_id  = auth.uid()
        and local_id    = p_local_id
        and pode_editar
    )
  );
$$;

-- produtos e apresentacoes são globais (não têm local_id), então não há
-- local para checar: a regra é gerenciar estoque em ao menos um lugar.
create or replace function fn_pode_editar_algum_local()
returns boolean language sql security definer stable as $$
  select fn_is_ativo() and (
    fn_is_admin() or exists (
      select 1 from usuarios_locais
      where usuario_id = auth.uid()
        and pode_editar
    )
  );
$$;

comment on function fn_pode_ver_local(int)        is 'Retorna true se o usuário logado pode visualizar dados do local informado. Exige perfil ativo.';
comment on function fn_pode_editar_local(int)     is 'Retorna true se o usuário logado pode alterar estoque do local informado.';
comment on function fn_pode_editar_algum_local()  is 'Retorna true se o usuário logado gerencia estoque em ao menos um local. Usada nas policies de produtos e apresentacoes, que são dados globais sem local_id.';

-- -------------------------------------------------------------
-- 17. ROW LEVEL SECURITY (RLS)
-- -------------------------------------------------------------
alter table papeis               enable row level security;
alter table categorias           enable row level security;
alter table unidades             enable row level security;
alter table motivos_movimentacao enable row level security;
alter table perfis               enable row level security;
alter table produtos             enable row level security;
alter table apresentacoes        enable row level security;
alter table locais               enable row level security;
alter table estoques             enable row level security;
alter table movimentacoes        enable row level security;
alter table usuarios_locais      enable row level security;

-- GRANT explícito: as demais tabelas herdaram os privilégios padrão do Supabase
-- na criação do projeto, mas uma tabela criada depois, por migração, não herda
-- nada. Sem isto o Postgres barra antes de avaliar o RLS, com
-- "42501: permission denied for table usuarios_locais". As policies abaixo é que
-- limitam quais linhas cada usuário enxerga.
grant select, insert, update, delete
  on public.usuarios_locais to authenticated;

-- === LEITURA — todos autenticados ===
create policy "autenticados podem ler papeis"
  on papeis for select to authenticated using (true);

create policy "autenticados podem ler categorias"
  on categorias for select to authenticated using (true);

create policy "autenticados podem ler unidades"
  on unidades for select to authenticated using (true);

create policy "autenticados podem ler motivos_movimentacao"
  on motivos_movimentacao for select to authenticated using (true);

create policy "autenticados podem ler perfis"
  on perfis for select to authenticated using (true);

create policy "autenticados podem ler produtos"
  on produtos for select to authenticated using (true);

create policy "autenticados podem ler apresentacoes"
  on apresentacoes for select to authenticated using (true);

-- Leitura por local: o seletor da TopBar se filtra sozinho, sem mudar o frontend.
create policy "usuario le locais permitidos"
  on locais for select to authenticated
  using (fn_pode_ver_local(id));

create policy "usuario le estoques dos locais permitidos"
  on estoques for select to authenticated
  using (fn_pode_ver_local(local_id));

-- movimentacoes não tem local_id; chega nele via estoques.
create policy "usuario le movimentacoes dos locais permitidos"
  on movimentacoes for select to authenticated
  using (
    exists (
      select 1 from estoques e
      where e.id = estoque_id
        and fn_pode_ver_local(e.local_id)
    )
  );

-- Usuário vê só os próprios acessos; só admin concede ou revoga.
create policy "usuario ve seus proprios acessos"
  on usuarios_locais for select to authenticated
  using (usuario_id = auth.uid() or fn_is_admin());

create policy "admin gerencia acessos"
  on usuarios_locais for all to authenticated
  using (fn_is_admin())
  with check (fn_is_admin());

-- === INSERÇÃO — exige gestão de estoque ===
-- produtos e apresentacoes são globais: basta gerenciar algum local.
create policy "gestores podem inserir produtos"
  on produtos for insert to authenticated
  with check (fn_pode_editar_algum_local());

create policy "gestores podem inserir apresentacoes"
  on apresentacoes for insert to authenticated
  with check (fn_pode_editar_algum_local());

-- Criar local é de admin: quem cria não recebe acesso automático
-- (nenhuma linha em usuarios_locais), então o local sumiria da tela.
create policy "admin pode inserir locais"
  on locais for insert to authenticated
  with check (fn_is_admin());

-- estoques tem local_id, então a checagem é precisa: o gerente da Cozinha
-- cria o produto globalmente, mas só dá saldo a ele na Cozinha.
create policy "gestores podem inserir estoques"
  on estoques for insert to authenticated
  with check (fn_pode_editar_local(local_id));

-- Ajuste de inventário (contagem física) só pode ser lançado por admin —
-- esse motivo reconcilia o saldo do sistema com a contagem real e pode
-- mascarar perdas/erros se qualquer usuário puder usá-lo livremente.
create policy "gestores podem inserir movimentacoes"
  on movimentacoes for insert to authenticated
  with check (
    criado_por = auth.uid()
    and exists (
      select 1 from estoques e
      where e.id = estoque_id
        and fn_pode_editar_local(e.local_id)
    )
    and (
      not exists (
        select 1 from motivos_movimentacao mo
        where mo.id = motivo_id and mo.codigo = 'ajuste'
      )
      or fn_is_admin()
    )
  );

-- === ATUALIZAÇÃO — perfil próprio ===
create policy "usuario edita proprio perfil"
  on perfis for update to authenticated
  using (id = auth.uid());

-- === ADMINISTRAÇÃO — apenas admins ===
create policy "admin pode atualizar qualquer perfil"
  on perfis for update to authenticated
  using (fn_is_admin());

create policy "admin pode inserir papeis"
  on papeis for insert to authenticated
  with check (fn_is_admin());

create policy "admin pode atualizar papeis"
  on papeis for update to authenticated
  using (fn_is_admin());

create policy "admin pode deletar papeis"
  on papeis for delete to authenticated
  using (fn_is_admin());

create policy "admin pode inserir categorias"
  on categorias for insert to authenticated
  with check (fn_is_admin());

create policy "admin pode atualizar categorias"
  on categorias for update to authenticated
  using (fn_is_admin());

create policy "admin pode deletar categorias"
  on categorias for delete to authenticated
  using (fn_is_admin());

create policy "admin pode gerenciar unidades"
  on unidades for all to authenticated
  using (fn_is_admin()) with check (fn_is_admin());

create policy "admin pode gerenciar motivos_movimentacao"
  on motivos_movimentacao for all to authenticated
  using (fn_is_admin()) with check (fn_is_admin());

create policy "admin pode atualizar produtos"
  on produtos for update to authenticated
  using (fn_is_admin());

create policy "admin pode atualizar apresentacoes"
  on apresentacoes for update to authenticated
  using (fn_is_admin());

create policy "admin pode deletar apresentacoes"
  on apresentacoes for delete to authenticated
  using (fn_is_admin());

create policy "admin pode deletar estoques"
  on estoques for delete to authenticated
  using (fn_is_admin());

-- Exclusão de movimentação é de admin: apaga uma linha do histórico, e o
-- trigger tg_reverte_estoque (11.1) devolve o efeito dela ao saldo. Sem
-- checagem de local — admin já enxerga e gerencia todos eles.
create policy "admin pode deletar movimentacoes"
  on movimentacoes for delete to authenticated
  using (fn_is_admin());

-- UPDATE direto em estoques é só de admin, e de propósito: RLS é por linha,
-- não por coluna, então conceder isto a um gerente daria junto o poder de
-- reescrever quantidade_atual por fora do histórico de movimentações.
-- Gerente de local altera o estoque mínimo via fn_define_estoque_minimo (18.2).
create policy "admin pode atualizar estoques"
  on estoques for update to authenticated
  using (fn_is_admin());

create policy "admin pode atualizar locais"
  on locais for update to authenticated
  using (fn_is_admin());

create policy "admin pode deletar locais"
  on locais for delete to authenticated
  using (fn_is_admin());

-- -------------------------------------------------------------
-- 18. TRIGGER — protege campos sensíveis do perfil
-- -------------------------------------------------------------
create or replace function fn_protege_perfil()
returns trigger language plpgsql security definer as $$
begin
  -- auth.uid() é NULL quando o update vem do SQL Editor ou da service role
  -- (contexto administrativo) — nesses casos a proteção não se aplica.
  -- Isso permite promover o primeiro admin sem desabilitar triggers.
  -- Pela API, requisições sem auth.uid() são anon/service_role, e anon
  -- não passa nas policies de update (todas são "to authenticated").
  if auth.uid() is not null and not fn_is_admin() then
    if NEW.is_admin is distinct from OLD.is_admin then
      raise exception 'Apenas administradores podem alterar o campo is_admin.';
    end if;
    if NEW.ativo is distinct from OLD.ativo then
      raise exception 'Apenas administradores podem ativar/desativar usuários.';
    end if;
    if NEW.papel_id is distinct from OLD.papel_id then
      raise exception 'Apenas administradores podem alterar o papel do usuário.';
    end if;
  end if;
  NEW.atualizado_em := now();
  return NEW;
end;
$$;

create trigger tg_protege_perfil
before update on perfis
for each row execute function fn_protege_perfil();

comment on function fn_protege_perfil() is
  'Impede que não-admins alterem is_admin, ativo ou papel_id. Atualiza atualizado_em automaticamente.';

-- -------------------------------------------------------------
-- 18.1 FUNÇÃO RPC — cadastro transacional de produto
--      Cria produto + apresentações + estoques + movimentações de
--      saldo inicial numa única transação: se qualquer etapa
--      falhar, nada é gravado (evita produtos pela metade).
--      SECURITY INVOKER: o RLS do usuário logado se aplica
--      normalmente a cada insert.
--
--      p_apresentacoes (jsonb):
--      [{ "descricao": "Galão 5L", "quantidade_unitaria": 5,
--         "unidade_id": 1,
--         "locais": [{ "local_id": 1, "quantidade_inicial": 10 }] }]
-- -------------------------------------------------------------
create or replace function fn_cria_produto_completo(
  p_nome          text,
  p_categoria_id  int,
  p_apresentacoes jsonb
)
returns int
language plpgsql
security invoker
as $$
declare
  v_produto_id    int;
  v_ap            jsonb;
  v_ap_id         int;
  v_loc           jsonb;
  v_estoque_id    int;
  v_qtd           numeric;
  v_motivo_saldo  int;
begin
  select id into v_motivo_saldo
    from motivos_movimentacao where codigo = 'saldo_inicial';

  if v_motivo_saldo is null then
    raise exception 'Motivo "saldo_inicial" não cadastrado.'
      using errcode = '23503';
  end if;

  insert into produtos (nome, categoria_id, criado_por)
  values (upper(trim(p_nome)), p_categoria_id, auth.uid())
  returning id into v_produto_id;

  for v_ap in select * from jsonb_array_elements(coalesce(p_apresentacoes, '[]'::jsonb)) loop
    insert into apresentacoes (produto_id, descricao, quantidade_unitaria, unidade_id, criado_por)
    values (
      v_produto_id,
      coalesce(nullif(trim(v_ap->>'descricao'), ''), upper(trim(p_nome))),
      (v_ap->>'quantidade_unitaria')::numeric,
      (v_ap->>'unidade_id')::int,
      auth.uid()
    )
    returning id into v_ap_id;

    for v_loc in select * from jsonb_array_elements(coalesce(v_ap->'locais', '[]'::jsonb)) loop
      insert into estoques (apresentacao_id, local_id)
      values (v_ap_id, (v_loc->>'local_id')::int)
      returning id into v_estoque_id;

      -- Saldo inicial entra como movimentação própria, preservando o
      -- histórico (o trigger atualiza o saldo). Motivo separado de 'ajuste',
      -- que é reconciliação de contagem física e é restrito a admin.
      v_qtd := coalesce((v_loc->>'quantidade_inicial')::numeric, 0);
      if v_qtd > 0 then
        insert into movimentacoes (estoque_id, criado_por, tipo, quantidade, motivo_id)
        values (v_estoque_id, auth.uid(), 'entrada', v_qtd, v_motivo_saldo);
      end if;
    end loop;
  end loop;

  return v_produto_id;
end;
$$;

comment on function fn_cria_produto_completo(text, int, jsonb) is
  'Cria produto, apresentações, estoques e saldo inicial em uma transação única. Usada pela tela de cadastro de produto.';

-- -------------------------------------------------------------
-- 18.2 FUNÇÃO RPC — estoque mínimo por gerente de local
--      Existe para não conceder UPDATE em estoques a não-admins:
--      estoque_minimo e quantidade_atual moram na mesma linha, e o RLS
--      do Postgres não separa colunas. Esta função toca em um campo só.
-- -------------------------------------------------------------
create or replace function fn_define_estoque_minimo(
  p_estoque_id int,
  p_valor      numeric
)
returns void
language plpgsql
security definer
as $$
declare
  v_local_id int;
begin
  select local_id into v_local_id
    from estoques where id = p_estoque_id;

  if v_local_id is null then
    raise exception 'Estoque não encontrado.'
      using errcode = '02000';
  end if;

  if not fn_pode_editar_local(v_local_id) then
    raise exception 'Sem permissão para alterar o estoque mínimo deste local.'
      using errcode = '42501';
  end if;

  if p_valor is null or p_valor < 0 then
    raise exception 'Estoque mínimo não pode ser negativo.'
      using errcode = '23514';
  end if;

  update estoques
     set estoque_minimo = p_valor,
         atualizado_em  = now()
   where id = p_estoque_id;
end;
$$;

comment on function fn_define_estoque_minimo(int, numeric) is
  'Altera o estoque mínimo de um estoque, se o usuário gerencia o local. Existe para não conceder UPDATE em estoques a não-admins, o que permitiria reescrever quantidade_atual por fora do histórico de movimentações.';

-- -------------------------------------------------------------
-- 18.3 FUNÇÃO RPC — apresentações em produto que já existe
--      Irmã de 18.1, para o outro caminho da busca-antes-de-criar:
--      o usuário achou o produto no catálogo global e quer mantê-lo
--      no seu local. Uma função = uma transação; fazer isso em três
--      chamadas do cliente deixaria apresentação sem estoque se a
--      segunda falhasse.
--
--      p_apresentacoes (jsonb): cada item é uma apresentação já
--      existente (tem "id") ou nova (descricao/quantidade_unitaria/
--      unidade_id). Os dois formatos convivem no mesmo array.
-- -------------------------------------------------------------
create or replace function fn_adiciona_apresentacoes_produto(
  p_produto_id    int,
  p_apresentacoes jsonb
)
returns int
language plpgsql
security invoker
as $$
declare
  v_produto_nome text;
  v_ap           jsonb;
  v_ap_id        int;
  v_loc          jsonb;
  v_estoque_id   int;
  v_qtd          numeric;
  v_motivo_saldo int;
begin
  select id into v_motivo_saldo
    from motivos_movimentacao where codigo = 'saldo_inicial';

  if v_motivo_saldo is null then
    raise exception 'Motivo "saldo_inicial" não cadastrado.'
      using errcode = '23503';
  end if;

  select nome into v_produto_nome
    from produtos where id = p_produto_id;

  if v_produto_nome is null then
    raise exception 'Produto não encontrado.'
      using errcode = '02000';
  end if;

  for v_ap in select * from jsonb_array_elements(coalesce(p_apresentacoes, '[]'::jsonb)) loop

    if (v_ap->>'id') is not null then
      -- Apresentação que já existe. Confere que ela pertence mesmo ao produto
      -- informado — sem isso, um id arbitrário vindo do cliente permitiria
      -- pendurar estoque na apresentação de outro produto.
      select id into v_ap_id
        from apresentacoes
       where id = (v_ap->>'id')::int
         and produto_id = p_produto_id;

      if v_ap_id is null then
        raise exception 'Apresentação % não pertence ao produto "%".',
          v_ap->>'id', v_produto_nome
          using errcode = '23503';
      end if;

    else
      insert into apresentacoes (produto_id, descricao, quantidade_unitaria, unidade_id, criado_por)
      values (
        p_produto_id,
        coalesce(nullif(trim(v_ap->>'descricao'), ''), v_produto_nome),
        (v_ap->>'quantidade_unitaria')::numeric,
        (v_ap->>'unidade_id')::int,
        auth.uid()
      )
      returning id into v_ap_id;
    end if;

    for v_loc in select * from jsonb_array_elements(coalesce(v_ap->'locais', '[]'::jsonb)) loop
      insert into estoques (apresentacao_id, local_id)
      values (v_ap_id, (v_loc->>'local_id')::int)
      on conflict (apresentacao_id, local_id) do nothing
      returning id into v_estoque_id;

      -- Vínculo que já existia devolve nada, e v_estoque_id fica nulo. Nesse caso
      -- não se lança movimentação: somar saldo a um vínculo preexistente seria
      -- inflar estoque silenciosamente se o usuário reenviar o formulário.
      if v_estoque_id is not null then
        v_qtd := coalesce((v_loc->>'quantidade_inicial')::numeric, 0);
        if v_qtd > 0 then
          insert into movimentacoes (estoque_id, criado_por, tipo, quantidade, motivo_id)
          values (v_estoque_id, auth.uid(), 'entrada', v_qtd, v_motivo_saldo);
        end if;
      end if;
    end loop;
  end loop;

  return p_produto_id;
end;
$$;

comment on function fn_adiciona_apresentacoes_produto(int, jsonb) is
  'Adiciona apresentações (novas ou já existentes) e seus estoques a um produto que já existe, em transação única. Usada pela busca-antes-de-criar da tela de cadastro de produto.';

-- -------------------------------------------------------------
-- 19. DADOS DE REFERÊNCIA
--     Este script cria bancos de PRODUÇÃO: aqui entram apenas as
--     tabelas de domínio que o sistema precisa para funcionar, nunca
--     produtos, locais ou saldos de exemplo. Para popular um banco de
--     testes com dados fictícios, rode `seed_demo.sql` depois deste.
--
--     Locais, produtos, apresentações e estoques nascem vazios e são
--     cadastrados pelo próprio app (Cadastros > Locais, Cadastro de
--     Produto). Papeis também: é opcional (o perfil aceita "Sem papel")
--     e não há tela de CRUD — insira via SQL se a organização usar.
-- -------------------------------------------------------------

insert into categorias (nome) values
  ('Limpeza'),
  ('Higiene'),
  ('Alimentação'),
  ('Escritório');

-- Unidades de medida normalizadas
insert into unidades (sigla, nome) values
  ('L',   'Litro'),
  ('ml',  'Mililitro'),
  ('kg',  'Quilograma'),
  ('g',   'Grama'),
  ('un',  'Unidade');

-- Motivos de movimentação normalizados.
-- NÃO é seed opcional: os códigos abaixo estão fixos no frontend
-- (Movimentacoes.jsx), nas views de consumo, nas policies e nas RPCs
-- fn_cria_produto_completo / fn_adiciona_apresentacoes_produto, que abortam
-- se 'saldo_inicial' não existir. Não há tela de CRUD para esta tabela.
insert into motivos_movimentacao (codigo, descricao) values
  ('uso',      'Consumo regular'),
  ('descarte', 'Item descartado por validade, dano ou inutilidade'),
  ('compra',   'Entrada por compra ou recebimento'),
  ('ajuste',   'Ajuste de inventário'),
  ('outro',    'Outro motivo não categorizado'),
  -- Separado de 'ajuste' de propósito: 'ajuste' é reconciliação de contagem
  -- física e é restrito a admin (ver policy em 17). Sem este motivo próprio,
  -- não-admin não conseguiria cadastrar produto com saldo inicial > 0.
  ('saldo_inicial', 'Saldo inicial do cadastro');

-- -------------------------------------------------------------
-- 20. USUÁRIO ADMIN INICIAL (bootstrap)
--     Cria admin@estoque.com (senha: estoque) direto no Supabase
--     Auth, já confirmado e promovido a admin. Idempotente: se o
--     e-mail já existir, não faz nada.
--
--     ATENÇÃO:
--       * Insert manual em auth.users não é oficialmente suportado
--         pela Supabase — se falhar após um upgrade do Auth, use o
--         plano B descrito na NOTA no fim do arquivo.
--       * Troque a senha "estoque" assim que o app for usado de
--         verdade pela empresa.
-- -------------------------------------------------------------
do $$
declare
  v_user_id uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users where email = 'admin@estoque.com') then
    raise notice 'admin@estoque.com já existe — nada a fazer.';
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    'admin@estoque.com',
    extensions.crypt('estoque', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nome":"Administrador"}'::jsonb,
    now(), now(),
    -- Strings vazias (não NULL) — NULL nesses campos quebra o login
    -- em versões atuais do GoTrue ("converting NULL to string").
    '', '', '', '', ''
  );

  -- Identidade e-mail/senha — obrigatória nas versões atuais do Auth
  insert into auth.identities (
    id, user_id, provider_id, provider,
    identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    'email',
    jsonb_build_object(
      'sub',            v_user_id::text,
      'email',          'admin@estoque.com',
      'email_verified', true
    ),
    now(), now(), now()
  );

  -- O insert acima disparou tg_cria_perfil (is_admin = false);
  -- aqui promovemos. Funciona porque fn_protege_perfil libera
  -- alterações quando auth.uid() é NULL (contexto administrativo).
  update public.perfis set is_admin = true where id = v_user_id;

  raise notice 'admin@estoque.com criado e promovido a admin.';
end $$;

-- =============================================================
-- NOTA: PRIMEIRO ADMINISTRADOR — PLANO B (manual)
-- Se o bloco 20 falhar (ex: mudança interna no schema do Auth):
--
--   1. Crie o usuário no Dashboard do Supabase:
--      Authentication > Users > Add user (marque "Auto Confirm User").
--      O trigger tg_cria_perfil criará a linha em perfis automaticamente.
--
--   2. No SQL Editor, promova-o a admin:
--
--        update public.perfis
--           set is_admin = true
--         where id = (select id from auth.users where email = 'seu@email.com');
--
--      Isso funciona porque fn_protege_perfil libera a alteração quando
--      auth.uid() é NULL (contexto do SQL Editor / service role).
--      Não é necessário desabilitar nenhum trigger.
--
--   3. Confira o resultado:
--
--        select u.email, p.nome, p.is_admin, p.ativo
--          from auth.users u
--          left join public.perfis p on p.id = u.id;
--
--      Se p.* vier NULL, o perfil não foi criado (usuário criado com o
--      trigger desabilitado). Corrija com:
--
--        insert into public.perfis (id, nome, is_admin)
--        select id, coalesce(raw_user_meta_data->>'nome', email), true
--          from auth.users where email = 'seu@email.com';
--
-- =============================================================

-- =============================================================
-- NOTA: BLOQUEIO COMPLETO DE LOGIN
-- Para impedir que um usuário desativado sequer faça login,
-- use a API Admin do Supabase via Edge Function:
--
--   -- Banir:
--   await supabase.auth.admin.updateUserById(userId, {
--     ban_duration: '876000h'
--   })
--
--   -- Desbanir:
--   await supabase.auth.admin.updateUserById(userId, {
--     ban_duration: 'none'
--   })
--
-- Isso garante dupla proteção: RLS no banco + Auth no Supabase.
-- =============================================================
