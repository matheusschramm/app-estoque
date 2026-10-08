# Fase 7 — Busca sem acento no Histórico

> **Estado:** aplicada no banco de **testes** e em **produção** (07/10/2026).
>
> **Pendência: o teste de RLS da seção 2.3.** Como a migração já está no ar, isto
> deixou de ser "testar antes de aplicar" e passou a ser **verificar o que está
> rodando** — nos dois bancos.
>
> A 2.3 não é formalidade. Esta migração usa `create or replace view`, e a view só
> respeita o RLS das tabelas-base com `security_invoker = on`. Sem o flag,
> `vw_auditoria_movimentacoes` roda com a permissão da dona e devolve o histórico de
> **todos** os locais para qualquer usuário autenticado, furando a restrição por local
> inteira. O script repete o `alter view` justamente por isso, mas é o que precisa ser
> conferido.

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

São três passos, do que não depende de dado nenhum para o que depende.

> **Antes de interpretar um zero aqui:** a `vw_auditoria_movimentacoes` parte de
> `movimentacoes`, então produto **sem lançamento não aparece nela**. Num banco novo a
> view está vazia e qualquer contagem dá zero — sem que isso diga nada sobre a
> migração. O passo 1 existe justamente para separar os dois casos.

#### 1. O mecanismo — vale até em banco vazio

```sql
select upper(extensions.unaccent('Açúcar Cristal')) as normalizado;
```

Esperado: `ACUCAR CRISTAL`. É isto que prova a migração: a extensão existe e produz
exatamente o mesmo que o `normalizar()` do JavaScript. Se der erro de função
inexistente, o `create extension` do bloco 1 não pegou.

#### 2. A coluna da view está normalizada

```sql
select
  (select count(*) from vw_auditoria_movimentacoes)            as linhas_na_view,
  (select count(*) from vw_auditoria_movimentacoes
    where busca <> upper(extensions.unaccent(busca)))          as busca_mal_normalizada;
```

`busca_mal_normalizada` tem que ser **0**: se a coluna já está sem acento e em
maiúsculas, normalizá-la de novo não muda nada.

`linhas_na_view` em **0** significa que o banco ainda não tem movimentação. Não é
falha — é só que não há o que medir aqui. Pule para a 2.3.

#### 3. Ponta a ponta, com o termo tirado dos próprios dados

O termo de busca sai da base, em vez de ser chumbado no script — assim o teste não
depende de existir um produto com um nome específico.

```sql
with amostra as (
  select produto
    from vw_auditoria_movimentacoes
   where produto <> upper(extensions.unaccent(produto))
   limit 1
)
select a.produto                             as produto_com_acento,
       upper(extensions.unaccent(a.produto)) as termo_sem_acento,
       (select count(*)
          from vw_auditoria_movimentacoes v
         where v.busca ilike '%' || upper(extensions.unaccent(a.produto)) || '%')
                                             as achou_buscando_sem_acento
  from amostra a;
```

Com uma linha de resultado, `achou_buscando_sem_acento` tem que ser **maior que zero**
— é a prova de que digitar sem acento encontra o produto acentuado.

**Zero linhas de resultado não é falha:** significa que nenhum produto com movimentação
tem acento no nome. Nesse caso o passo 1 já garantiu o mecanismo, e a prova de verdade
é na tela — busque "acucar" no Histórico e veja se acha "AÇÚCAR".

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

Tem que vir `on` ou `true`. Essa consulta é a checagem principal — se vier `off`,
corrija com `alter view vw_auditoria_movimentacoes set (security_invoker = on);` e
rode de novo.

#### Prova prática

Pegue o UUID de um **não-admin**. Tem que ser não-admin: `fn_is_admin()` concede tudo,
então um admin enxergaria o histórico inteiro mesmo com o RLS perfeito.

```sql
select id, nome from perfis where is_admin = false order by nome;
```

O bloco abaixo devolve **uma linha com o veredito**. Ele tira um acesso do usuário
antes de medir, porque alguém que já enxerga todos os locais não provaria nada — e o
`rollback` no fim devolve o acesso, nada fica gravado.

```sql
begin;
  -- Remove um dos acessos do usuário (desfeito no rollback).
  delete from usuarios_locais
   where usuario_id = 'COLE-O-UUID-DO-NAO-ADMIN'
     and local_id = (select min(local_id) from usuarios_locais
                      where usuario_id = 'COLE-O-UUID-DO-NAO-ADMIN');

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"COLE-O-UUID-DO-NAO-ADMIN"}';

  select
    (select is_admin from perfis where id = auth.uid())                as eh_admin,

    (select coalesce(string_agg(l.nome, ', ' order by l.nome), '(nenhum)')
       from usuarios_locais ul
       join locais l on l.id = ul.local_id
      where ul.usuario_id = auth.uid())                                as locais_concedidos,

    (select coalesce(string_agg(x.nome_local, ', ' order by x.nome_local), '(nenhum)')
       from (select distinct local as nome_local
               from vw_auditoria_movimentacoes) x)                     as locais_no_historico,

    (select count(*) from vw_auditoria_movimentacoes)                  as linhas_visiveis,

    (select not exists (
       select 1 from vw_auditoria_movimentacoes v
        where not exists (
          select 1 from usuarios_locais ul
           where ul.usuario_id = auth.uid()
             and ul.local_id   = v.local_id)))                         as rls_ok;
rollback;
```

Como ler o resultado:

| Coluna | O que esperar |
|---|---|
| `eh_admin` | **false**. Se vier `true`, o UUID está errado e o teste não vale |
| `locais_concedidos` | os locais que sobraram para ele, um a menos que o normal |
| `locais_no_historico` | tem que ser **igual ou subconjunto** de `locais_concedidos` |
| `linhas_visiveis` | movimentações que ele enxerga — informativo, não é veredito |
| `rls_ok` | **true**. É esta a resposta |

`rls_ok` é `true` quando toda linha visível pertence a um local concedido. Se vier
`false`, ou aparecer em `locais_no_historico` um local que não está em
`locais_concedidos`, a view está furando o RLS.

> `linhas_visiveis` conta **movimentações**, não locais — não compare esse número com a
> quantidade de locais cadastrados. Dez movimentações em um único local é um resultado
> perfeitamente normal.

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
