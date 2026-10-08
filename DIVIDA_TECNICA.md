# Dívida técnica — lint

Registro do que o `npx eslint src` acusa hoje, para limpar de uma vez depois que
a refatoração de acesso por local terminar.

**Estado em 08/10/2026:** 17 erros e 1 aviso, em 10 arquivos.
Nenhum quebra o build — `npx vite build` passa limpo.

```
npx eslint src
```

---

## 1. `react-hooks/set-state-in-effect` — 13 erros

O grosso da dívida, e um padrão único repetido no projeto todo:

```jsx
const fetch = useCallback(async () => {
  setLoading(true);
  const { data } = await supabase.from('...').select();
  setRows(data ?? []);
  setLoading(false);
}, []);

useEffect(() => { fetch(); }, [fetch]);
```

Onde aparece:

| Arquivo | Linhas |
|---|---|
| `src/pages/Movimentacoes.jsx` | 283, 302, 323, 343 |
| `src/pages/Configuracoes.jsx` | 500, 741 |
| `src/pages/Historico.jsx` | 132, 135 |
| `src/pages/CadastroProduto.jsx` | 168 |
| `src/pages/Compras.jsx` | 26 |
| `src/pages/ProdutoDetalhe.jsx` | 68 |
| `src/components/TabelaCrud.jsx` | 66 |
| `src/contexts/LocalContext.jsx` | 57 |

**Por que não foi corrigido pontualmente:** é o idioma de carregamento de dados de
toda a base. Consertar um arquivo só cria duas convenções convivendo, o que é pior
que a dívida. Vale fazer numa passada única.

**Como resolver:** extrair um hook `useCarregamento(fn, deps)` que encapsule
`loading`/`dados`/`erro` e chamar dele em todas as telas. Some o erro e ainda tira
a repetição de `loading` e do tratamento de erro, que hoje é copiada tela a tela.

---

## 2. `react-refresh/only-export-components` — 3 erros

Arquivos que exportam componente **e** outra coisa, o que atrapalha o hot reload:

| Arquivo | Linha | O que exporta junto |
|---|---|---|
| `src/components/TabelaCrud.jsx` | 29 | `ConfirmDialog`, `Spinner`, `traduzErro` |
| `src/contexts/AuthContext.jsx` | 82 | `useAuth` |
| `src/contexts/LocalContext.jsx` | 87 | `useLocal` |

**Como resolver:** mover `traduzErro` para `src/lib/`, e os hooks `useAuth`/`useLocal`
para arquivos próprios (`useAuth.js`, `useLocal.js`). É mecânico, mas mexe em import
de quase toda tela — melhor num commit isolado.

---

## 3. `no-unused-vars` — 1 erro

`src/pages/Cadastros.jsx:37` — `Icon` desestruturado do `map` e nunca usado.
Correção de uma linha.

---

## 4. `react-hooks/exhaustive-deps` — 1 aviso — **NÃO CORRIGIR**

`src/pages/Movimentacoes.jsx:345`

```jsx
useEffect(() => {
  if (!motivosFiltrados.length) return;
  if (!motivosFiltrados.some(m => String(m.id) === motivoId)) {
    setMotivoId(String(motivosFiltrados[0].id));
  }
}, [tipo, motivos]);   // motivoId e motivosFiltrados omitidos DE PROPÓSITO
```

Este aviso é **intencional** e a lista de dependências está certa como está.

Incluir `motivoId` faria o efeito rodar a cada escolha do usuário; incluir
`motivosFiltrados` (array recriado a cada render) faria rodar a cada render. Nos dois
casos o efeito sobrescreveria a escolha manual do usuário.

**O bug que isso corrigiu:** saídas marcadas como "Consumo regular" eram gravadas com
motivo `ajuste`. O `<select>` tinha um valor que não correspondia a nenhum `<option>`
visível — a tela mostrava a primeira opção, mas o estado guardava o motivo antigo.
O efeito existe só para reconciliar isso quando o **tipo** muda, e não deve rodar em
nenhuma outra situação.

Se for silenciar, use `// eslint-disable-next-line react-hooks/exhaustive-deps` com
o motivo escrito ao lado — **não** adicione as dependências.
