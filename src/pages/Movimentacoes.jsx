import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useLocal } from '../contexts/LocalContext';
import {
  Search, ArrowDownCircle, ArrowUpCircle, AlertCircle, Scale, Eye,
  CornerDownLeft,
} from 'lucide-react';
import { traduzErro } from '../components/TabelaCrud';
import Kbd from '../components/Kbd';
import { useToast } from '../lib/toast';
import { normalizar } from '../lib/texto';

/* ─── helpers ─── */
function Label({ children, required }) {
  return (
    <label className="text-[11px] font-bold text-app-text-label uppercase tracking-widest">
      {children}{required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
  );
}

function SectionHeader({ number, title, subtitle }) {
  return (
    <div className="px-6 py-4 border-b border-app-border-inner flex items-center gap-3">
      <span className="w-6 h-6 rounded-full bg-app-text text-white flex items-center justify-center text-[11px] font-bold shrink-0">
        {number}
      </span>
      <span className="text-[13px] font-bold text-app-text uppercase tracking-wide">{title}</span>
      {subtitle && <span className="text-[11px] text-app-text-secondary">{subtitle}</span>}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/* ─── combobox de produto ───
   Busca o catálogo inteiro, não só o do local selecionado. Um produto que
   existe em outro estoque precisa aparecer para o aviso "não vinculada a
   este local" poder levar o usuário à tela do produto — filtrar aqui
   esconderia esse caminho e empurraria para o cadastro duplicado.

   O catálogo vem de uma consulta só, no lugar de um ilike por tecla: com
   ida ao servidor a cada letra a navegação por teclado fica intragável, e
   o ilike ainda ignora acento ("acucar" não achava "AÇÚCAR"). */
const MAX_RESULTADOS = 10;

function ProdutoBusca({ valor, onValorChange, onSelect, erro, inputRef }) {
  const [catalogo, setCatalogo]       = useState([]);
  const [carregando, setCarregando]   = useState(true);
  const [aberto, setAberto]           = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(0);

  const ref          = useRef(null);
  const itemAtivoRef = useRef(null);

  useEffect(() => {
    supabase
      .from('produtos')
      .select('id, nome, categorias(nome)')
      .order('nome')
      .then(({ data }) => {
        setCatalogo(data ?? []);
        setCarregando(false);
      });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setAberto(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const termo = normalizar(valor).trim();

  const resultados = useMemo(() => {
    if (!termo) return [];
    return catalogo
      .filter(p => normalizar(p.nome).includes(termo))
      .slice(0, MAX_RESULTADOS);
  }, [catalogo, termo]);

  const painelAberto = aberto && termo.length > 0;

  /* Mantém a linha destacada à vista quando a navegação passa do fim da área
     rolável. 'nearest' evita o salto quando ela já está visível. */
  useEffect(() => {
    if (painelAberto) itemAtivoRef.current?.scrollIntoView({ block: 'nearest' });
  }, [indiceAtivo, painelAberto]);

  const selecionar = (produto) => {
    onValorChange(produto.nome);
    setAberto(false);
    onSelect(produto);
  };

  const handleKeyDown = (e) => {
    /* Seta para baixo com o painel fechado reabre, em vez de não fazer nada:
       é como se volta à lista depois de fechar por engano. */
    if (!painelAberto) {
      if (e.key === 'ArrowDown' && termo.length > 0) {
        e.preventDefault();
        setAberto(true);
        setIndiceAtivo(0);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setAberto(false);
      return;
    }
    if (!resultados.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndiceAtivo(i => (i + 1) % resultados.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndiceAtivo(i => (i - 1 + resultados.length) % resultados.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setIndiceAtivo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setIndiceAtivo(resultados.length - 1);
    } else if (e.key === 'Enter') {
      /* preventDefault senão o Enter envia o formulário da tela inteira. */
      e.preventDefault();
      const escolhido = resultados[indiceAtivo] ?? resultados[0];
      if (escolhido) selecionar(escolhido);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-label pointer-events-none"
        />
        <input
          ref={inputRef}
          type="text"
          value={valor}
          onChange={(e) => {
            onValorChange(e.target.value);
            setAberto(true);
            setIndiceAtivo(0);
            onSelect(null);
          }}
          onFocus={() => setAberto(true)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar produto pelo nome…"
          autoComplete="off"
          role="combobox"
          aria-expanded={painelAberto}
          aria-controls="painel-produtos"
          aria-autocomplete="list"
          aria-activedescendant={painelAberto ? `produto-${indiceAtivo}` : undefined}
          className={`input-base w-full pl-9 ${erro ? 'border-rose-400' : ''}`}
        />
      </div>

      {painelAberto && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-30 card shadow-[0_16px_40px_rgba(0,0,0,0.12)] overflow-hidden">
          {carregando ? (
            <div className="px-4 py-3 text-[13px] text-app-text-secondary">
              Carregando produtos…
            </div>
          ) : resultados.length > 0 ? (
            <>
              <div
                id="painel-produtos"
                role="listbox"
                className="max-h-60 overflow-y-auto divide-y divide-app-border-inner"
              >
                {resultados.map((p, i) => {
                  const ativo = i === indiceAtivo;
                  return (
                    <button
                      key={p.id}
                      id={`produto-${i}`}
                      ref={ativo ? itemAtivoRef : null}
                      type="button"
                      role="option"
                      aria-selected={ativo}
                      onMouseEnter={() => setIndiceAtivo(i)}
                      onClick={() => selecionar(p)}
                      className={`w-full text-left px-4 py-2.5 border-l-2 transition-colors flex items-center gap-3 ${
                        ativo ? 'bg-app-bg border-app-text' : 'border-transparent'
                      }`}
                    >
                      <span className="text-[13px] font-semibold text-app-text truncate flex-1">
                        {p.nome}
                      </span>
                      {p.categorias?.nome && (
                        <span className="badge-sky text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0">
                          {p.categorias.nome}
                        </span>
                      )}
                      {ativo && <CornerDownLeft size={13} className="text-app-text-label shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <div className="px-4 py-2 border-t border-app-border-inner bg-white flex items-center gap-3 text-[10px] text-app-text-label">
                <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
                <span><Kbd>↵</Kbd> selecionar</span>
                <span><Kbd>esc</Kbd> fechar</span>
              </div>
            </>
          ) : (
            <div className="px-4 py-3 text-[13px] text-app-text-secondary">
              Nenhum produto encontrado para “{valor.trim()}”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   Página principal
═══════════════════════════════════════════ */
export default function Movimentacoes() {
  const { user, isAdmin } = useAuth();
  const { localAtual, podeEditarAtual } = useLocal();
  const toast = useToast();

  /* O combobox e o inicio do fluxo: quem chega aqui vai digitar um produto.
     Receber o foco de entrada e devolve-lo apos cada gravacao deixa a tela
     inteira operavel sem tirar a mao do teclado. */
  const buscaRef = useRef(null);
  useEffect(() => { buscaRef.current?.focus(); }, []);

  /* ── dados mestres ── */
  const [motivos, setMotivos]       = useState([]);
  const [apresentacoes, setApresentacoes] = useState([]);
  const [estoques, setEstoques]     = useState([]); // estoques da apresentação selecionada

  /* ── seleções ── */
  const [modo, setModo]                 = useState('movimento'); // 'movimento' | 'ajuste'
  const [produto, setProduto]           = useState(null);
  const [buscaProduto, setBuscaProduto] = useState('');
  const [apresentacaoId, setApresentacaoId] = useState('');
  const [estoqueId, setEstoqueId]       = useState('');
  const [tipo, setTipo]                 = useState('saida');
  const [motivoId, setMotivoId]         = useState('');
  const [quantidade, setQuantidade]     = useState('');
  const [quantidadeContada, setQuantidadeContada] = useState('');
  const [data, setData]                 = useState(() => new Date().toISOString().slice(0, 16));

  /* ── estado ── */
  const [loading, setLoading]   = useState(false);
  const [erros, setErros]       = useState({});
  const [estoqueAtual, setEstoqueAtual] = useState(null);

  /* ─ Carrega motivos ─
     Não define motivoId aqui: o motivo padrão depende do tipo e da lista
     filtrada — isso é resolvido no efeito abaixo, senão o valor pode
     apontar para um motivo que não está entre as opções visíveis. */
  useEffect(() => {
    supabase.from('motivos_movimentacao').select('id, codigo, descricao').order('descricao')
      .then(({ data }) => {
        if (data) setMotivos(data);
      });
  }, []);

  /* ─ Carrega apresentações quando produto muda ─ */
  useEffect(() => {
    setApresentacaoId('');
    setEstoques([]);
    setEstoqueId('');
    setEstoqueAtual(null);
    if (!produto) { setApresentacoes([]); return; }

    supabase
      .from('apresentacoes')
      .select('id, descricao, quantidade_unitaria, unidades(sigla)')
      .eq('produto_id', produto.id)
      .order('descricao')
      .then(({ data }) => {
        setApresentacoes(data ?? []);
        if (data?.length) setApresentacaoId(String(data[0].id));
      });
  }, [produto]);

  /* ─ Carrega o estoque da apresentação no local selecionado na barra ─ */
  useEffect(() => {
    setEstoqueId('');
    setEstoqueAtual(null);
    if (!apresentacaoId || !localAtual) { setEstoques([]); return; }

    supabase
      .from('estoques')
      .select('id, quantidade_atual, locais(id, nome)')
      .eq('apresentacao_id', Number(apresentacaoId))
      .eq('local_id', localAtual.id)
      .then(({ data }) => {
        setEstoques(data ?? []);
        if (data?.length) {
          setEstoqueId(String(data[0].id));
          setEstoqueAtual(Number(data[0].quantidade_atual));
        }
      });
  }, [apresentacaoId, localAtual]);

  /* ─ Atualiza estoque atual quando local muda ─ */
  useEffect(() => {
    const est = estoques.find(e => String(e.id) === estoqueId);
    setEstoqueAtual(est ? Number(est.quantidade_atual) : null);
  }, [estoqueId, estoques]);

  /* ─ Filtra motivos conforme tipo ─
     'ajuste' não aparece aqui: tem fluxo próprio (modo "Ajuste de contagem"),
     que calcula a diferença automaticamente e é restrito a admin via RLS. */
  const motivosFiltrados = motivos.filter(m => {
    if (tipo === 'entrada') return ['compra', 'outro'].includes(m.codigo);
    return ['uso', 'descarte', 'outro'].includes(m.codigo);
  });

  const motivoAjuste = motivos.find(m => m.codigo === 'ajuste');

  /* Garante que motivoId seja sempre um motivo presente na lista filtrada.
     Roda quando os motivos carregam ou o tipo muda; só reescreve se o
     valor atual não estiver entre as opções válidas (evita loop e não
     atrapalha uma escolha manual do usuário). */
  useEffect(() => {
    if (!motivosFiltrados.length) return;
    if (!motivosFiltrados.some(m => String(m.id) === motivoId)) {
      setMotivoId(String(motivosFiltrados[0].id));
    }
  }, [tipo, motivos]);

  /* ─ Diferença entre a contagem física e o saldo do sistema (modo ajuste) ─ */
  const diferencaAjuste = quantidadeContada !== '' && estoqueAtual !== null
    ? Number(quantidadeContada) - estoqueAtual
    : null;

  /* ─ Validação ─ */
  const validate = () => {
    const e = {};
    if (!produto)           e.produto      = 'Selecione um produto.';
    if (!apresentacaoId)    e.apresentacao = 'Selecione uma apresentação.';
    if (!estoqueId)         e.estoque      = `Esta apresentação não está vinculada ao local ${localAtual?.nome ?? 'selecionado'}.`;

    if (modo === 'ajuste') {
      if (quantidadeContada === '' || Number(quantidadeContada) < 0)
                            e.quantidade   = 'Informe a quantidade contada fisicamente (pode ser zero).';
      else if (diferencaAjuste === 0)
                            e.quantidade   = 'A contagem já bate com o saldo do sistema — nenhum ajuste necessário.';
    } else {
      if (!quantidade || Number(quantidade) <= 0)
                            e.quantidade   = 'Informe uma quantidade maior que zero.';
      if (tipo === 'saida' && estoqueAtual !== null && Number(quantidade) > estoqueAtual)
                            e.quantidade   = `Estoque insuficiente. Disponível: ${estoqueAtual}`;
    }
    setErros(e);
    return Object.keys(e).length === 0;
  };

  /* ─ Submissão ─ */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);

    let payload;
    if (modo === 'ajuste') {
      // Reconsulta o saldo atual para reduzir a chance de ajustar em cima
      // de um valor desatualizado (ex: outra pessoa lançou algo enquanto
      // o formulário estava aberto).
      const { data: estAtual, error: errEst } = await supabase
        .from('estoques')
        .select('quantidade_atual')
        .eq('id', Number(estoqueId))
        .single();

      if (errEst) {
        setLoading(false);
        toast.erro(traduzErro(errEst));
        return;
      }

      const saldoReal = Number(estAtual.quantidade_atual);
      const diferenca = Number(quantidadeContada) - saldoReal;

      if (diferenca === 0) {
        setLoading(false);
        setErros({ quantidade: 'A contagem já bate com o saldo do sistema — nenhum ajuste necessário.' });
        return;
      }

      payload = {
        estoque_id: Number(estoqueId),
        criado_por: user.id,
        tipo: diferenca > 0 ? 'entrada' : 'saida',
        quantidade: Math.abs(diferenca),
        motivo_id: motivoAjuste?.id ?? null,
        data: new Date(data).toISOString(),
      };
    } else {
      payload = {
        estoque_id: Number(estoqueId),
        criado_por: user.id,
        tipo,
        quantidade: Number(quantidade),
        motivo_id: motivoId ? Number(motivoId) : null,
        data: new Date(data).toISOString(),
      };
    }

    const { error } = await supabase.from('movimentacoes').insert([payload]);

    setLoading(false);

    if (error) {
      toast.erro(traduzErro(error));
    } else {
      toast.sucesso(modo === 'ajuste'
        ? 'Ajuste registrado com sucesso!'
        : 'Movimentação registrada com sucesso!');
      /* modo e tipo sobrevivem ao reset de proposito: quem faz um ajuste
         normalmente faz varios seguidos. */
      resetForm();
      buscaRef.current?.focus();
    }
  };

  const resetForm = () => {
    setProduto(null);
    setBuscaProduto('');
    setApresentacaoId('');
    setEstoqueId('');
    setQuantidade('');
    setQuantidadeContada('');
    setData(new Date().toISOString().slice(0, 16));
    setErros({});
  };

  const apSelecionada = apresentacoes.find(a => String(a.id) === apresentacaoId);

  const cabecalho = (
    <header className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl mb-0.5">Movimentações</h1>
        <p className="text-[13px] text-app-text-secondary">
          {localAtual
            ? <>Registre entradas e saídas em <span className="font-semibold text-app-text">{localAtual.nome}</span>.</>
            : 'Selecione um local na barra superior para registrar movimentações.'}
        </p>
      </div>
    </header>
  );

  /* Quem só visualiza o local não vê o formulário. Deixá-lo à mostra seria
     pior que escondê-lo: a pessoa preencheria tudo para o RLS recusar no
     final, sem entender por quê. */
  if (localAtual && !podeEditarAtual) {
    return (
      <div className="flex flex-col gap-5">
        {cabecalho}
        <div className="card p-8 flex flex-col items-center text-center gap-3">
          <div className="w-11 h-11 rounded-full bg-app-bg flex items-center justify-center text-app-text-label">
            <Eye size={20} />
          </div>
          <p className="text-[14px] font-bold text-app-text">
            Seu acesso a {localAtual.nome} é somente leitura
          </p>
          <p className="text-[13px] text-app-text-secondary max-w-md">
            Você pode consultar o catálogo e o histórico deste local, mas não
            registrar movimentações. Peça a um administrador para liberar a
            gestão do local, ou troque de local na barra superior.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">

      {cabecalho}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>

        {/* ── Tipo ── */}
        <div className="card">
          <SectionHeader number="1" title="Tipo de Movimentação" />
          <div className={`p-6 grid gap-3 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <button
              type="button"
              onClick={() => { setModo('movimento'); setTipo('saida'); }}
              className={`flex items-center gap-3 p-4 rounded-xl border-[1.5px] transition-all cursor-pointer ${
                modo === 'movimento' && tipo === 'saida'
                  ? 'border-rose-400 bg-rose-50 text-rose-700'
                  : 'border-app-border hover:border-rose-200 text-app-text-secondary'
              }`}
            >
              <ArrowUpCircle size={22} />
              <div className="text-left">
                <p className="text-[13px] font-bold">Saída</p>
                <p className="text-[11px] opacity-75">Consumo, descarte ou retirada</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setModo('movimento'); setTipo('entrada'); }}
              className={`flex items-center gap-3 p-4 rounded-xl border-[1.5px] transition-all cursor-pointer ${
                modo === 'movimento' && tipo === 'entrada'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-app-border hover:border-emerald-200 text-app-text-secondary'
              }`}
            >
              <ArrowDownCircle size={22} />
              <div className="text-left">
                <p className="text-[13px] font-bold">Entrada</p>
                <p className="text-[11px] opacity-75">Compra ou recebimento</p>
              </div>
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setModo('ajuste')}
                className={`flex items-center gap-3 p-4 rounded-xl border-[1.5px] transition-all cursor-pointer ${
                  modo === 'ajuste'
                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-app-border hover:border-amber-200 text-app-text-secondary'
                }`}
              >
                <Scale size={22} />
                <div className="text-left">
                  <p className="text-[13px] font-bold">Ajuste de Contagem</p>
                  <p className="text-[11px] opacity-75">Reconciliar com a contagem física</p>
                </div>
              </button>
            )}
          </div>
        </div>

        {/* ── Produto ── */}
        <div className="card !overflow-visible h-[289px]">
          <SectionHeader number="2" title="Produto" />
          <div className="p-6 grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label required>Produto</Label>
              <ProdutoBusca
                valor={buscaProduto}
                onValorChange={setBuscaProduto}
                onSelect={setProduto}
                erro={erros.produto}
                inputRef={buscaRef}
              />
              {erros.produto && <span className="text-rose-500 text-[11px]">{erros.produto}</span>}
            </div>

            {/* Apresentação */}
            {apresentacoes.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label required>Apresentação / Embalagem</Label>
                <select
                  value={apresentacaoId}
                  onChange={e => setApresentacaoId(e.target.value)}
                  className={`input-base ${erros.apresentacao ? 'border-rose-400' : ''}`}
                >
                  {apresentacoes.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.descricao} ({a.quantidade_unitaria} {a.unidades?.sigla})
                    </option>
                  ))}
                </select>
                {erros.apresentacao && <span className="text-rose-500 text-[11px]">{erros.apresentacao}</span>}
              </div>
            )}

            {/* Apresentação sem vínculo com o local atual */}
            {apresentacaoId && localAtual && estoques.length === 0 && (
              <div className="col-span-2 flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2.5 text-[12px]">
                <AlertCircle size={14} className="shrink-0" />
                <span className="flex-1">
                  Esta apresentação não está vinculada ao local{' '}
                  <span className="font-bold">{localAtual.nome}</span>.{' '}
                  {produto && (
                    <Link to={`/produtos/${produto.id}`} className="font-bold underline hover:no-underline">
                      Vincular na tela do produto
                    </Link>
                  )}
                </span>
              </div>
            )}

            {/* Estoque atual badge */}
            {estoqueAtual !== null && apSelecionada && localAtual && (
              <div className="col-span-2 flex items-center gap-2">
                <span className="text-[11px] text-app-text-label">
                  Saldo atual em {localAtual.nome}:
                </span>
                <span className={`text-[13px] font-bold ${estoqueAtual === 0 ? 'text-rose-500' : 'text-app-text'}`}>
                  {estoqueAtual} emb. de {Number(apSelecionada.quantidade_unitaria)} {apSelecionada.unidades?.sigla}
                </span>
              </div>
            )}
            {erros.estoque && !estoqueId && (
              <span className="col-span-2 text-rose-500 text-[11px]">{erros.estoque}</span>
            )}
          </div>
        </div>

        {/* ── Detalhes ── */}
        <div className="card">
          <SectionHeader number="3" title={modo === 'ajuste' ? 'Contagem Física' : 'Detalhes da Movimentação'} />
          <div className="p-6 grid grid-cols-2 gap-4">
            {modo === 'ajuste' ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label required>Quantidade contada</Label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={quantidadeContada}
                    onChange={e => setQuantidadeContada(e.target.value)}
                    placeholder="Ex: 5"
                    className={`input-base ${erros.quantidade ? 'border-rose-400' : ''}`}
                  />
                  {erros.quantidade && <span className="text-rose-500 text-[11px]">{erros.quantidade}</span>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Diferença</Label>
                  <div className="input-base flex items-center bg-app-bg text-[13px] font-bold">
                    {diferencaAjuste === null ? (
                      <span className="text-app-text-label font-normal">—</span>
                    ) : diferencaAjuste === 0 ? (
                      <span className="text-app-text-secondary font-normal">Sem diferença</span>
                    ) : diferencaAjuste > 0 ? (
                      <span className="text-emerald-600">+{diferencaAjuste.toFixed(4)} (gera entrada)</span>
                    ) : (
                      <span className="text-rose-600">{diferencaAjuste.toFixed(4)} (gera saída)</span>
                    )}
                  </div>
                </div>

                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label>Motivo</Label>
                  <p className="text-[12px] text-app-text-secondary">
                    Ajuste de inventário — lançado automaticamente como entrada ou saída conforme a diferença acima.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Data / Hora</Label>
                  <input
                    type="datetime-local"
                    value={data}
                    onChange={e => setData(e.target.value)}
                    className="input-base"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label required>Quantidade</Label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={quantidade}
                    onChange={e => setQuantidade(e.target.value)}
                    placeholder="Ex: 3"
                    className={`input-base ${erros.quantidade ? 'border-rose-400' : ''}`}
                  />
                  {erros.quantidade && <span className="text-rose-500 text-[11px]">{erros.quantidade}</span>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label required>Motivo</Label>
                  <select
                    value={motivoId}
                    onChange={e => setMotivoId(e.target.value)}
                    className="input-base"
                  >
                    {motivosFiltrados.map(m => (
                      <option key={m.id} value={m.id}>{m.descricao}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Data / Hora</Label>
                  <input
                    type="datetime-local"
                    value={data}
                    onChange={e => setData(e.target.value)}
                    className="input-base"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Ações ── */}
        <div className="flex items-center justify-end gap-3">
          <button type="button" className="btn btn-secondary px-5 py-2.5" onClick={resetForm}>
            Limpar
          </button>
          <button
            type="submit"
            disabled={loading || !produto || (modo === 'ajuste' && diferencaAjuste === 0)}
            className={`btn btn-primary flex items-center gap-2 px-6 py-2.5 text-[13px] ${
              modo === 'ajuste' ? 'bg-amber-500 hover:opacity-90' : tipo === 'entrada' ? '' : 'bg-rose-600 hover:opacity-90'
            }`}
          >
            {loading ? <Spinner /> : modo === 'ajuste'
              ? <Scale size={15} />
              : tipo === 'entrada'
                ? <ArrowDownCircle size={15} />
                : <ArrowUpCircle size={15} />}
            {loading ? 'Salvando...' : modo === 'ajuste' ? 'Registrar Ajuste' : tipo === 'entrada' ? 'Registrar Entrada' : 'Registrar Saída'}
          </button>
        </div>
      </form>
    </div>
  );
}
