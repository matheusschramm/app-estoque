# Fase 7 — Busca sem acento no Histórico

**Onde rodar:** SQL Editor do Supabase (banco de **TESTES**).
**Pré-requisito:** nenhum além do schema atual.
**Impacto no app:** nenhum até a tela nova entrar. A view ganha uma coluna a mais, e
quem faz `select *` só recebe um campo extra que ignora.

---

## Por que esta tela precisa de SQL e as outras não

Catálogo e Relatório carregam as linhas do local e filtram no cliente — lá dá para
normalizar em JavaScript e pronto. O Histórico é diferente: ele filtra **no servidor**,
porque pagina de 20 em 20 e pode ter milhares de linhas. Trazer tudo para o navegador
só para ignorar acento seria trocar um defeito pequeno por um grande.

E o `ilike` do Postgres **não** ignora acento: `'acucar' ilike '%AÇÚCAR%'` é falso.
Então a normalização tem que existir do lado do banco.

A saída é uma coluna `busca` na view, já sem acento e em maiúsculas, com os campos que
a tela pesquisa concatenados. A consulta vira um `ilike` só sobre ela.

### Efeito colateral bem-vindo

A tela montava a busca com `.or('produto.ilike.…,usuario.ilike.…')`, e vírgula ou
parêntese no texto quebravam a **sintaxe** do `.or()` do PostgREST — a busca falhava
em silêncio. Por isso existia um `replace(/[,()]/g, ' ')` antes da consulta,
arrancando caracteres do que o usuário digitou.

Com um `ilike` sobre uma coluna só, não há mais `.or()` para quebrar, e essa gambiarra
sai junto.

---

## 1. A view ganha a coluna `busca`

```sql
-- unaccent faz no Postgres o que o normalizar() faz no JavaScript. Para o
-- conjunto de letras do português os dois chegam ao mesmo resultado, que é o
-- que mantém as duas pontas da busca de acordo.
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
  -- Coluna de busca: mesmos campos que a tela pesquisa, sem acento e em
  -- maiúsculas. Fica por último de propósito — create or replace view só
  -- aceita colunas novas no fim.
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

-- create or replace view preserva as reloptions, mas repetir é barato e evita
-- depender disso: sem o flag a view ignora o RLS e devolve todos os locais.
alter view vw_auditoria_movimentacoes set (security_invoker = on);

comment on view vw_auditoria_movimentacoes is
  'Histórico completo de movimentações com produto, local e usuário responsável. A coluna busca concatena produto, apresentação e usuário sem acento, para o filtro de texto da tela.';
```

> **Sem índice, de propósito.** `unaccent` é `STABLE`, não `IMMUTABLE`, então indexar
> exigiria envolvê-la numa função própria marcada como imutável. Para o volume desta
> base o ganho não paga a peça extra. Se o Histórico ficar lento, o caminho é esse
> wrapper mais um índice GIN com `pg_trgm` sobre `busca`.

---

## 2. Conferência

### 2.1 A coluna existe e está normalizada

```sql
select produto, apresentacao, usuario, busca
  from vw_auditoria_movimentacoes
 limit 5;
```

`busca` tem que vir em maiúsculas, sem acento, com os três campos juntos.

### 2.2 O acento deixou de importar

Pegue um produto que tenha acento no nome:

```sql
select nome from produtos where nome <> upper(extensions.unaccent(nome)) limit 5;
```

Se voltar algo — digamos `AÇÚCAR` — confirme que a busca sem acento acha:

```sql
select count(*) as achou_sem_acento
  from vw_auditoria_movimentacoes
 where busca ilike '%ACUCAR%';

select count(*) as achou_com_acento
  from vw_auditoria_movimentacoes
 where busca ilike '%AÇÚCAR%';
```

Esperado: `achou_sem_acento` maior que zero, e `achou_com_acento` **igual a zero** — a
coluna guarda a versão sem acento, então é com ela que a tela compara. É por isso que o
frontend normaliza o termo antes de enviar.

> Se o passo anterior não devolveu nenhum produto acentuado, este teste não prova nada
> nesta base. Cadastre um produto com acento no app e repita, ou pule para o 2.3.

### 2.3 O RLS continua valendo

Esta é a parte que um `create or replace view` poderia ter derrubado.

```sql
select c.relname,
       coalesce((select option_value
                   from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'off') as security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'vw_auditoria_movimentacoes';
```

Tem que vir `on` ou `true`. Para provar na prática, com um não-admin:

```sql
select id, nome from perfis where is_admin = false order by nome;
```

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"COLE-O-UUID-DO-NAO-ADMIN"}';
  select count(*) as auditoria_visivel from vw_auditoria_movimentacoes;
rollback;
```

O número tem que ser menor que o total, a não ser que esse usuário tenha acesso a
todos os locais.

---

## Rollback

Volta a view sem a coluna `busca`. **Rode junto com o deploy do frontend antigo** — a
tela nova depende da coluna.

O `drop` não é opcional: `create or replace view` sabe acrescentar coluna, mas não
remover, e sem ele o comando falharia com "cannot drop columns from view". Nada mais
no schema depende desta view, então o drop é seguro.

```sql
drop view vw_auditoria_movimentacoes;

create view vw_auditoria_movimentacoes as
select
  m.id, m.data, m.tipo, m.quantidade, a.quantidade_unitaria,
  u.sigla      as unidade,
  mo.codigo    as motivo,
  mo.descricao as motivo_descricao,
  p.nome       as produto,
  a.descricao  as apresentacao,
  l.id         as local_id,
  l.nome       as local,
  pf.nome      as usuario,
  pa.nome      as cargo_usuario,
  pf.is_admin  as usuario_admin
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

alter view vw_auditoria_movimentacoes set (security_invoker = on);

comment on view vw_auditoria_movimentacoes is
  'Histórico completo de movimentações com produto, local e usuário responsável.';
```

> O `drop view` descarta as reloptions junto, então o `alter view` acima deixa de ser
> redundância e passa a ser obrigatório. Sem ele a view volta furando o RLS.
