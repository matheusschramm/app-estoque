import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  Plus, Trash2, CheckCircle, ChevronLeft, Package, MapPin,
  Search, CornerDownLeft, Eye,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLocal } from '../contexts/LocalContext';
import { traduzErro } from '../components/TabelaCrud';
import Kbd from '../components/Kbd';
import { useToast } from '../lib/toast';
import { normalizar } from '../lib/texto';

/* A comparação roda no cliente porque o catálogo inteiro cabe em poucos KB:
   busca instantânea, sem debounce nem ida ao servidor a cada tecla. */
const MAX_SUGESTOES = 8;

/* ─────────────────────────────────────────────
   Componente de rótulo de campo
───────────────────────────────────────────── */
function Label({ children, required }) {
  return (
    <label className="text-[11px] font-bold text-app-text-label uppercase tracking-widest">
      {children}
      {required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
  );
}

/* ─────────────────────────────────────────────
   Tela de sucesso
───────────────────────────────────────────── */
function SuccessScreen({ produtoExistente, nome, onCadastrarOutro, onVerCatalogo }) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl mb-0">Cadastro de Produto</h1>
      </header>

      <div className="card p-16 flex flex-col items-center gap-5 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center">
          <CheckCircle size={32} className="text-emerald-500" />
        </div>
        <div>
          <p className="text-[17px] font-bold text-app-text mb-1">
            {produtoExistente
              ? 'Apresentações adicionadas com sucesso!'
              : 'Produto cadastrado com sucesso!'}
          </p>
          <p className="text-[13px] text-app-text-secondary">
            {produtoExistente
              ? <>Os estoques e saldos iniciais de <span className="font-semibold">{nome}</span> foram salvos.</>
              : <>O produto, apresentações e saldos iniciais foram salvos.</>}
          </p>
        </div>
        <div className="flex gap-3 mt-2">
          <button className="btn btn-secondary px-5 py-2.5" onClick={onCadastrarOutro}>
            Cadastrar outro
          </button>
          <button className="btn btn-primary px-5 py-2.5" onClick={onVerCatalogo}>
            Ir para o Catálogo
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Formulário principal
───────────────────────────────────────────── */
const emptyApresentacao = (unidades = [], localAtual = null) => ({
  descricao: '',
  quantidade_unitaria: '',
  unidade_id: unidades.length ? String(unidades[0].id) : '',
  locais: localAtual ? [{ local_id: localAtual.id, quantidade_inicial: '0' }] : [],
});

export default function CadastroProduto() {
  const navigate = useNavigate();
  const { localAtual, locais: locaisContexto, podeEditarAtual, podeEditarAlgum, loadingLocal } = useLocal();
  const toast = useToast();

  /* Só os locais que o usuário gerencia: vincular apresentação a um local é
     um INSERT em estoques, que o RLS recusa fora deles. Oferecer os demais
     na tela só produziria um erro no fim do preenchimento. */
  const locais = useMemo(
    () => locaisContexto.filter(l => l.pode_editar),
    [locaisContexto]
  );
  /* Idem para a pré-seleção do local da barra superior. */
  const localPadrao = podeEditarAtual ? localAtual : null;

  /* ── Dados mestres ── */
  const [categorias, setCategorias] = useState([]);
  const [unidades, setUnidades]     = useState([]);
  const [catalogo, setCatalogo]     = useState([]);
  const [loadingDados, setLoadingDados] = useState(true);

  /* ── Busca / identificação do produto ── */
  const [nomeProduto, setNomeProduto] = useState('');
  const [produtoSel, setProdutoSel]   = useState(null);   // null = cadastrando produto novo
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const buscaRef = useRef(null);

  /* ── Produto novo ── */
  const [categoriaId, setCategoriaId] = useState('');

  /* ── Apresentações ── */
  const [apsExistentes, setApsExistentes] = useState([]);  // do produto já cadastrado
  const [apresentacoes, setApresentacoes] = useState([emptyApresentacao()]);  // novas

  /* ── Estado da submissão ── */
  const [loading, setLoading]   = useState(false);
  const [success, setSuccess]   = useState(false);
  const [erros, setErros]       = useState({});

  /* Catálogo global — de propósito não filtra por local. É o que permite ver
     que um produto já existe em outro estoque antes de duplicá-lo. O
     aninhamento "estoques" respeita o RLS: só vêm os locais visíveis.

     Está numa função própria porque precisa ser relido depois de cada
     cadastro: sem isso, quem encadeia vários produtos compara o próximo
     contra uma lista que não contém o que ele acabou de criar — justamente
     o duplicado mais provável. Vale também para o modo "adicionar ao
     estoque", que alimenta o marcador "já tem" dos locais. */
  const carregarCatalogo = useCallback(async () => {
    const { data } = await supabase
      .from('produtos')
      .select(`
        id, nome,
        categorias (nome),
        apresentacoes (
          id, descricao, quantidade_unitaria, unidade_id,
          unidades (sigla),
          estoques (local_id)
        )
      `)
      .order('nome');
    if (data) setCatalogo(data);
  }, []);

  /* ────────────────────────────────────────── */
  useEffect(() => {
    async function fetchDados() {
      const [{ data: cats }, { data: units }] =
        await Promise.all([
          supabase.from('categorias').select('id, nome').order('nome'),
          supabase.from('unidades').select('id, sigla, nome').order('sigla'),
          carregarCatalogo(),
        ]);

      if (cats)  setCategorias(cats);
      if (units) {
        setUnidades(units);
        setApresentacoes([emptyApresentacao(units)]);
      }
      setLoadingDados(false);
    }
    fetchDados();
  }, [carregarCatalogo]);

  /* ── Pré-seleciona o local da barra superior nas apresentações sem local ──
     Depende de loadingDados porque fetchDados recria a apresentação inicial. */
  useEffect(() => {
    if (!localPadrao || loadingDados || produtoSel) return;
    setApresentacoes(prev =>
      prev.map(a =>
        a.locais.length === 0
          ? { ...a, locais: [{ local_id: localPadrao.id, quantidade_inicial: '0' }] }
          : a
      )
    );
  }, [localPadrao, loadingDados, produtoSel]);

  /* ── Fecha o painel de sugestões ao clicar fora ── */
  useEffect(() => {
    if (!buscaAberta) return;
    const fechar = (e) => {
      if (buscaRef.current && !buscaRef.current.contains(e.target)) setBuscaAberta(false);
    };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [buscaAberta]);

  /* ── Sugestões do catálogo ── */
  const termo = normalizar(nomeProduto).trim();
  const sugestoes = useMemo(() => {
    if (produtoSel || termo.length < 2) return [];
    return catalogo
      .filter(p => normalizar(p.nome).includes(termo))
      .slice(0, MAX_SUGESTOES);
  }, [catalogo, termo, produtoSel]);

  const painelAberto = buscaAberta && !produtoSel && termo.length >= 2;

  /* ── Navegação por teclado no painel ──
     O último índice é a linha "cadastrar novo", que por isso nunca fica
     inalcançável. Enter precisa de preventDefault: o input está dentro de
     um <form>, e sem isso o Enter enviaria o cadastro em vez de escolher. */
  const handleBuscaKeyDown = (e) => {
    if (!painelAberto) return;
    const total = sugestoes.length + 1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndiceAtivo(i => (i + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndiceAtivo(i => (i - 1 + total) % total);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (indiceAtivo < sugestoes.length) selecionarProduto(sugestoes[indiceAtivo]);
      else setBuscaAberta(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setBuscaAberta(false);
    }
  };

  /* ── Escolhe um produto que já existe ── */
  const selecionarProduto = (p) => {
    setProdutoSel(p);
    setNomeProduto(p.nome);
    setBuscaAberta(false);
    setErros({});
    setApsExistentes(
      (p.apresentacoes ?? [])
        .slice()
        .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
        .map(a => ({ ...a, selecionada: false, locais: [] }))
    );
    setApresentacoes([]);   // nenhuma embalagem nova por padrão
  };

  /* ── Volta a cadastrar produto novo ── */
  const voltarParaNovo = () => {
    setProdutoSel(null);
    setApsExistentes([]);
    setApresentacoes([emptyApresentacao(unidades, localPadrao)]);
    setErros({});
    setBuscaAberta(true);
  };

  /* ── Helpers: apresentações novas ── */
  const updateApresentacao = (index, field, value) =>
    setApresentacoes(prev =>
      prev.map((a, i) => (i === index ? { ...a, [field]: value } : a))
    );

  const addApresentacao = () =>
    setApresentacoes(prev => [...prev, emptyApresentacao(unidades, localPadrao)]);

  const removeApresentacao = (index) =>
    setApresentacoes(prev => prev.filter((_, i) => i !== index));

  const toggleLocal = (apIndex, localId) =>
    setApresentacoes(prev =>
      prev.map((a, i) => {
        if (i !== apIndex) return a;
        const exists = a.locais.find(l => l.local_id === localId);
        return {
          ...a,
          locais: exists
            ? a.locais.filter(l => l.local_id !== localId)
            : [...a.locais, { local_id: localId, quantidade_inicial: '0' }],
        };
      })
    );

  const updateLocalQtd = (apIndex, localId, qtd) =>
    setApresentacoes(prev =>
      prev.map((a, i) =>
        i !== apIndex ? a : {
          ...a,
          locais: a.locais.map(l =>
            l.local_id === localId ? { ...l, quantidade_inicial: qtd } : l
          ),
        }
      )
    );

  /* ── Helpers: apresentações que já existem ── */
  const toggleApExistente = (apId) =>
    setApsExistentes(prev =>
      prev.map(a => {
        if (a.id !== apId) return a;
        if (a.selecionada) return { ...a, selecionada: false, locais: [] };

        // Ao marcar, já sugere o local da barra superior — desde que ele
        // ainda não tenha essa apresentação vinculada.
        const jaVinculados = new Set((a.estoques ?? []).map(e => e.local_id));
        const sugerido = localPadrao && !jaVinculados.has(localPadrao.id)
          ? [{ local_id: localPadrao.id, quantidade_inicial: '0' }]
          : [];
        return { ...a, selecionada: true, locais: sugerido };
      })
    );

  const toggleLocalExistente = (apId, localId) =>
    setApsExistentes(prev =>
      prev.map(a => {
        if (a.id !== apId) return a;
        const exists = a.locais.find(l => l.local_id === localId);
        return {
          ...a,
          locais: exists
            ? a.locais.filter(l => l.local_id !== localId)
            : [...a.locais, { local_id: localId, quantidade_inicial: '0' }],
        };
      })
    );

  const updateLocalQtdExistente = (apId, localId, qtd) =>
    setApsExistentes(prev =>
      prev.map(a =>
        a.id !== apId ? a : {
          ...a,
          locais: a.locais.map(l =>
            l.local_id === localId ? { ...l, quantidade_inicial: qtd } : l
          ),
        }
      )
    );

  /* ── Validação ── */
  const validate = () => {
    const novosErros = {};

    if (!produtoSel && !nomeProduto.trim()) {
      novosErros.nomeProduto = 'Nome do produto é obrigatório.';
    }

    apresentacoes.forEach((a, i) => {
      if (!a.descricao.trim()) {
        novosErros[`ap_${i}_descricao`] = 'Descrição da apresentação é obrigatória.';
      }
      if (!a.quantidade_unitaria || Number(a.quantidade_unitaria) <= 0) {
        novosErros[`ap_${i}_qtd`] = 'Quantidade deve ser maior que zero.';
      }
      if (!a.unidade_id) {
        novosErros[`ap_${i}_unidade`] = 'Selecione uma unidade.';
      }
      /* Sem local, a apresentação nasce sem estoque em lugar nenhum e some
         de todas as telas, que são filtradas por local. */
      if (a.locais.length === 0) {
        novosErros[`ap_${i}_locais`] = 'Selecione ao menos um local.';
      }
    });

    const existentesMarcadas = apsExistentes.filter(a => a.selecionada);
    existentesMarcadas.forEach(a => {
      if (a.locais.length === 0) {
        novosErros[`apx_${a.id}_locais`] = 'Selecione ao menos um local.';
      }
    });

    if (produtoSel && existentesMarcadas.length === 0 && apresentacoes.length === 0) {
      novosErros.nada = 'Escolha uma apresentação existente ou adicione uma nova.';
    }

    setErros(novosErros);
    return Object.keys(novosErros).length === 0;
  };

  /* ── Submissão ──
     Tudo numa única transação via RPC: se qualquer etapa falhar, nada é
     gravado. Duas RPCs porque os dois caminhos gravam coisas diferentes. */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);

    const mapLocais = (ls) => ls.map(l => ({
      local_id: l.local_id,
      quantidade_inicial: Math.max(Number(l.quantidade_inicial) || 0, 0),
    }));

    const novas = apresentacoes.map(ap => ({
      descricao: ap.descricao.trim(),
      quantidade_unitaria: Number(ap.quantidade_unitaria),
      unidade_id: Number(ap.unidade_id),
      locais: mapLocais(ap.locais),
    }));

    const { error } = produtoSel
      ? await supabase.rpc('fn_adiciona_apresentacoes_produto', {
          p_produto_id: produtoSel.id,
          p_apresentacoes: [
            ...apsExistentes
              .filter(a => a.selecionada)
              .map(a => ({ id: a.id, locais: mapLocais(a.locais) })),
            ...novas,
          ],
        })
      : await supabase.rpc('fn_cria_produto_completo', {
          p_nome: nomeProduto.trim(),
          p_categoria_id: categoriaId ? Number(categoriaId) : null,
          p_apresentacoes: novas,
        });

    setLoading(false);

    if (error) {
      toast.erro(
        error.code === '23505'
          ? (produtoSel
              ? 'Esse produto já tem uma apresentação com essa descrição.'
              : 'Já existe um produto com esse nome.')
          : traduzErro(error)
      );
      return;
    }
    setSuccess(true);
  };

  /* ── Reset para novo cadastro ── */
  const resetForm = () => {
    /* Sem await: a busca só sugere a partir de dois caracteres digitados,
       então a lista nova chega antes de o painel abrir. */
    carregarCatalogo();
    setNomeProduto('');
    setCategoriaId('');
    setProdutoSel(null);
    setApsExistentes([]);
    setApresentacoes([emptyApresentacao(unidades, localPadrao)]);
    setErros({});
    setSuccess(false);
  };

  /* A rota é acessível por URL, então o bloqueio mora aqui e não só no botão
     do Catálogo. E ele segue o local da barra, não "gerencia algum local":
     cadastrar a partir de um local que se apenas visualiza jogaria o produto
     em outro estoque, sem o usuário perceber. */
  if (!loadingLocal && !podeEditarAtual) {
    return (
      <div className="flex flex-col gap-5">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="p-1.5 rounded-lg hover:bg-app-border/60 text-app-text-secondary hover:text-app-text transition-all"
          >
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-2xl mb-0">Novo Produto</h1>
        </header>
        <div className="card p-8 flex flex-col items-center text-center gap-3">
          <div className="w-11 h-11 rounded-full bg-app-bg flex items-center justify-center text-app-text-label">
            <Eye size={20} />
          </div>
          <p className="text-[14px] font-bold text-app-text">
            {podeEditarAlgum
              ? `Seu acesso a ${localAtual?.nome ?? 'este local'} é somente leitura`
              : 'Você não gerencia nenhum local'}
          </p>
          <p className="text-[13px] text-app-text-secondary max-w-md">
            {podeEditarAlgum
              ? 'Cadastrar um produto vincula ele a um local. Troque na barra superior para um local que você gerencia e volte aqui.'
              : 'Cadastrar um produto exige vinculá-lo a pelo menos um local, e o seu acesso hoje é só de leitura. Peça a um administrador para liberar a gestão de um local.'}
          </p>
        </div>
      </div>
    );
  }

  /* ─────────── Tela de sucesso ─────────── */
  if (success) {
    return (
      <SuccessScreen
        produtoExistente={!!produtoSel}
        nome={nomeProduto}
        onCadastrarOutro={resetForm}
        onVerCatalogo={() => navigate('/')}
      />
    );
  }

  /* ─────────── Formulário ─────────── */
  return (
    <div className="flex flex-col gap-5">

      {/* Cabeçalho */}
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="p-1.5 rounded-lg hover:bg-app-border/60 text-app-text-secondary hover:text-app-text transition-all"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl mb-0.5">
            {produtoSel ? 'Adicionar ao Estoque' : 'Novo Produto'}
          </h1>
          <p className="text-[13px] text-app-text-secondary">
            {produtoSel
              ? 'Escolha as embalagens e os locais onde este produto será mantido.'
              : 'Busque o produto — se ainda não existir, cadastre um novo.'}
          </p>
        </div>
      </header>


      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>

        {/* ══════════ Seção 1 — Produto ══════════ */}
        {/* overflow-visible: .card recorta com overflow-hidden por causa dos
            cantos arredondados, e isso cortava o painel de sugestões quando a
            lista passava da altura do card. Nada aqui dentro precisa do corte. */}
        <div className="card overflow-visible">
          <SectionHeader number="1" title="Produto" />

          <div className="p-6 grid grid-cols-2 gap-4">
            {/* Busca / nome */}
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label required>{produtoSel ? 'Produto' : 'Qual produto?'}</Label>

              {produtoSel ? (
                <div className="flex items-center gap-3 border-[1.5px] border-app-text bg-app-bg rounded-lg px-3 py-[9px]">
                  <Package size={15} className="text-app-text-label shrink-0" />
                  <span className="text-sm font-semibold text-app-text flex-1">
                    {produtoSel.nome}
                  </span>
                  {produtoSel.categorias?.nome && (
                    <span className="badge-sky text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded">
                      {produtoSel.categorias.nome}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={voltarParaNovo}
                    className="text-[11px] font-semibold text-app-text-secondary hover:text-app-text underline underline-offset-2"
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <div className="relative" ref={buscaRef}>
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-label pointer-events-none"
                  />
                  <input
                    type="text"
                    value={nomeProduto}
                    onChange={(e) => {
                      setNomeProduto(e.target.value.toUpperCase());
                      setBuscaAberta(true);
                      setIndiceAtivo(0);
                    }}
                    onFocus={() => { setBuscaAberta(true); setIndiceAtivo(0); }}
                    onKeyDown={handleBuscaKeyDown}
                    placeholder="Ex: ÁGUA SANITÁRIA"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={painelAberto}
                    aria-controls="painel-sugestoes"
                    aria-autocomplete="list"
                    aria-activedescendant={painelAberto ? `sugestao-${indiceAtivo}` : undefined}
                    className={`input-base w-full pl-9 ${erros.nomeProduto ? 'border-rose-400 focus:border-rose-400' : ''}`}
                  />

                  {painelAberto && (
                    <SugestoesPainel
                      sugestoes={sugestoes}
                      termoDigitado={nomeProduto.trim()}
                      indiceAtivo={indiceAtivo}
                      onHover={setIndiceAtivo}
                      onSelecionar={selecionarProduto}
                      onCriarNovo={() => setBuscaAberta(false)}
                    />
                  )}
                </div>
              )}

              {erros.nomeProduto && (
                <span className="text-rose-500 text-[11px]">{erros.nomeProduto}</span>
              )}
              {!produtoSel && (
                <span className="text-[11px] text-app-text-label">
                  A busca olha todos os estoques, inclusive os que você não acessa —
                  assim o mesmo produto não é cadastrado duas vezes com nomes diferentes.
                </span>
              )}
            </div>

            {/* Categoria — só faz sentido ao criar produto novo */}
            {!produtoSel && (
              <div className="flex flex-col gap-1.5">
                <Label>Categoria</Label>
                <select
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
                  className="input-base"
                >
                  <option value="">Sem categoria</option>
                  {categorias.map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* ══════════ Seção 2 — Apresentações ══════════ */}
        <div className="card">
          <div className="px-6 py-4 border-b border-app-border-inner flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-app-text text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                2
              </span>
              <div>
                <span className="text-[13px] font-bold text-app-text uppercase tracking-wide">
                  Apresentações
                </span>
                <span className="text-[11px] text-app-text-secondary ml-2">
                  embalagens / tamanhos
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={addApresentacao}
              className="btn btn-secondary flex items-center gap-1.5 text-[12px]"
            >
              <Plus size={13} />
              {produtoSel ? 'Nova embalagem' : 'Adicionar'}
            </button>
          </div>

          {erros.nada && (
            <div className="px-6 pt-4">
              <span className="text-rose-500 text-[11px]">{erros.nada}</span>
            </div>
          )}

          {/* Apresentações que o produto já tem */}
          {produtoSel && (
            <div className="divide-y divide-app-border-inner">
              {apsExistentes.length === 0 ? (
                <p className="px-6 py-4 text-[12px] text-app-text-secondary">
                  Este produto ainda não tem nenhuma apresentação cadastrada.
                  Use “Nova embalagem” para criar a primeira.
                </p>
              ) : (
                apsExistentes.map(ap => (
                  <ApresentacaoExistente
                    key={ap.id}
                    ap={ap}
                    locais={locais}
                    erro={erros[`apx_${ap.id}_locais`]}
                    onToggle={toggleApExistente}
                    onToggleLocal={toggleLocalExistente}
                    onUpdateLocalQtd={updateLocalQtdExistente}
                  />
                ))
              )}
            </div>
          )}

          {/* Apresentações novas */}
          <div className="divide-y divide-app-border-inner">
            {apresentacoes.map((ap, i) => (
              <ApresentacaoCard
                key={i}
                index={i}
                ap={ap}
                unidades={unidades}
                locais={locais}
                erros={erros}
                podeRemover={produtoSel ? true : apresentacoes.length > 1}
                onUpdate={updateApresentacao}
                onRemove={removeApresentacao}
                onToggleLocal={toggleLocal}
                onUpdateLocalQtd={updateLocalQtd}
              />
            ))}
          </div>
        </div>

        {/* Ações */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            className="btn btn-secondary px-5 py-2.5"
            onClick={() => navigate('/')}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary flex items-center gap-2 px-6 py-2.5 text-[13px]"
            disabled={loading || loadingDados}
          >
            {loading ? (
              <>
                <Spinner />
                Salvando...
              </>
            ) : (
              <>
                <Package size={15} />
                {produtoSel ? 'Adicionar ao Estoque' : 'Cadastrar Produto'}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Sub-componentes
───────────────────────────────────────────── */
function SectionHeader({ number, title }) {
  return (
    <div className="px-6 py-4 border-b border-app-border-inner flex items-center gap-3">
      <span className="w-6 h-6 rounded-full bg-app-text text-white flex items-center justify-center text-[11px] font-bold shrink-0">
        {number}
      </span>
      <span className="text-[13px] font-bold text-app-text uppercase tracking-wide">
        {title}
      </span>
    </div>
  );
}

/* Tecla desenhada, para as dicas do rodapé do painel. */
/* Painel de sugestões do catálogo global.
   Não mostra em quais locais o produto existe: além de vazar o que o RLS
   restringe, é irrelevante — o que importa é "esse produto já existe".

   O mouse escreve no mesmo indiceAtivo que as setas, então os dois nunca
   destacam linhas diferentes ao mesmo tempo. */
function SugestoesPainel({
  sugestoes, termoDigitado, indiceAtivo, onSelecionar, onCriarNovo, onHover,
}) {
  const itemAtivoRef = useRef(null);
  const indiceCriar  = sugestoes.length;

  /* Mantém a linha destacada visível quando a navegação passa do fim da área
     rolável. 'nearest' evita o salto de rolagem quando ela já está à vista. */
  useEffect(() => {
    itemAtivoRef.current?.scrollIntoView({ block: 'nearest' });
  }, [indiceAtivo]);

  return (
    <div className="absolute left-0 right-0 top-full mt-1.5 z-30 card shadow-[0_16px_40px_rgba(0,0,0,0.12)] overflow-hidden">
      <div
        id="painel-sugestoes"
        role="listbox"
        className="max-h-72 overflow-y-auto divide-y divide-app-border-inner"
      >
        {sugestoes.map((p, i) => {
          const ativo = i === indiceAtivo;
          return (
            <button
              key={p.id}
              id={`sugestao-${i}`}
              ref={ativo ? itemAtivoRef : null}
              type="button"
              role="option"
              aria-selected={ativo}
              onMouseEnter={() => onHover(i)}
              onClick={() => onSelecionar(p)}
              className={`w-full text-left px-4 py-3 border-l-2 transition-colors flex items-start gap-3 ${
                ativo ? 'bg-app-bg border-app-text' : 'border-transparent'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-app-text truncate">
                    {p.nome}
                  </span>
                  {p.categorias?.nome && (
                    <span className="badge-sky text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0">
                      {p.categorias.nome}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-app-text-secondary truncate block mt-0.5">
                  {p.apresentacoes?.length
                    ? p.apresentacoes.map(a => a.descricao).join(' · ')
                    : 'Sem apresentações cadastradas'}
                </span>
              </div>
              {ativo && (
                <CornerDownLeft size={13} className="text-app-text-label shrink-0 mt-1" />
              )}
            </button>
          );
        })}
      </div>

      {/* Caminho de criação — sempre presente, sempre por último. */}
      <button
        id={`sugestao-${indiceCriar}`}
        type="button"
        role="option"
        aria-selected={indiceAtivo === indiceCriar}
        onMouseEnter={() => onHover(indiceCriar)}
        onClick={onCriarNovo}
        className={`w-full text-left px-4 py-3 border-t-[1.5px] border-app-border border-l-2 transition-colors flex items-center gap-2 ${
          indiceAtivo === indiceCriar ? 'bg-app-bg border-l-app-text' : 'bg-app-bg/60 border-l-transparent'
        }`}
      >
        <Plus size={14} className="text-app-text-label shrink-0" />
        <span className="text-[12px] text-app-text-secondary">
          Cadastrar <span className="font-bold text-app-text">“{termoDigitado}”</span> como novo produto
        </span>
      </button>

      <div className="px-4 py-2 border-t border-app-border-inner bg-white flex items-center gap-3 text-[10px] text-app-text-label">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
        <span><Kbd>↵</Kbd> selecionar</span>
        <span><Kbd>esc</Kbd> fechar</span>
      </div>
    </div>
  );
}

/* Grade de locais, compartilhada pelos dois tipos de apresentação. */
function LocaisPicker({ locais, selecionados, bloqueados, onToggle, onUpdateQtd, erro }) {
  if (locais.length === 0) {
    return <p className="text-[12px] text-app-text-secondary">Nenhum local cadastrado.</p>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {locais.map(loc => {
          const bloqueado   = bloqueados?.has(loc.id);
          const selecionado = selecionados.find(l => l.local_id === loc.id);

          if (bloqueado) {
            return (
              <div
                key={loc.id}
                className="border border-dashed border-app-border rounded-xl p-3 flex items-center gap-3 select-none opacity-60"
              >
                <CheckCircle size={15} className="text-emerald-500 shrink-0" />
                <span className="text-[13px] font-medium text-app-text-secondary flex-1">
                  {loc.nome}
                </span>
                <span className="text-[10px] text-app-text-label uppercase tracking-wider font-bold">
                  já tem
                </span>
              </div>
            );
          }

          return (
            <div
              key={loc.id}
              onClick={() => onToggle(loc.id)}
              className={`
                border rounded-xl p-3 flex items-center gap-3 cursor-pointer
                transition-all duration-150 select-none
                ${selecionado
                  ? 'border-app-text bg-app-bg shadow-sm'
                  : 'border-app-border hover:border-app-text-label hover:bg-app-bg/40'
                }
              `}
            >
              <div
                className={`
                  w-4 h-4 rounded border-[1.5px] flex items-center justify-center shrink-0
                  transition-all duration-150
                  ${selecionado ? 'bg-app-text border-app-text' : 'border-app-border-inner bg-white'}
                `}
              >
                {selecionado && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>

              <span className="text-[13px] font-medium text-app-text flex-1">{loc.nome}</span>

              {selecionado && (
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[10px] text-app-text-label uppercase tracking-wider font-bold">
                    Qtd:
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={selecionado.quantidade_inicial}
                    onChange={(e) => onUpdateQtd(loc.id, e.target.value)}
                    className="w-16 input-base py-1 px-2 text-center text-[12px] font-bold"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {erro && <span className="text-rose-500 text-[11px]">{erro}</span>}
    </>
  );
}

/* Apresentação que o produto já tem: marcar significa "quero esta no meu estoque". */
function ApresentacaoExistente({ ap, locais, erro, onToggle, onToggleLocal, onUpdateLocalQtd }) {
  const jaVinculados = useMemo(
    () => new Set((ap.estoques ?? []).map(e => e.local_id)),
    [ap.estoques]
  );

  const disponiveis = locais.filter(l => !jaVinculados.has(l.id));

  return (
    <div className="p-6 flex flex-col gap-4">
      <div
        onClick={() => onToggle(ap.id)}
        className="flex items-center gap-3 cursor-pointer select-none"
      >
        <div
          className={`
            w-4 h-4 rounded border-[1.5px] flex items-center justify-center shrink-0
            transition-all duration-150
            ${ap.selecionada ? 'bg-app-text border-app-text' : 'border-app-border-inner bg-white'}
          `}
        >
          {ap.selecionada && (
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
              <path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        <span className="text-[13px] font-semibold text-app-text">{ap.descricao}</span>
        <span className="text-[11px] text-app-text-secondary">
          {ap.quantidade_unitaria} {ap.unidades?.sigla}
        </span>

        {disponiveis.length === 0 && (
          <span className="text-[10px] text-app-text-label uppercase tracking-wider font-bold ml-auto">
            em todos os seus locais
          </span>
        )}
      </div>

      {ap.selecionada && disponiveis.length > 0 && (
        <div className="flex flex-col gap-2 pl-7">
          <div className="flex items-center gap-2">
            <MapPin size={13} className="text-app-text-label" />
            <Label>Locais de Estoque</Label>
          </div>
          <LocaisPicker
            locais={locais}
            selecionados={ap.locais}
            bloqueados={jaVinculados}
            onToggle={(localId) => onToggleLocal(ap.id, localId)}
            onUpdateQtd={(localId, qtd) => onUpdateLocalQtd(ap.id, localId, qtd)}
            erro={erro}
          />
        </div>
      )}
    </div>
  );
}

function ApresentacaoCard({
  index, ap, unidades, locais, erros, podeRemover,
  onUpdate, onRemove, onToggleLocal, onUpdateLocalQtd,
}) {
  return (
    <div className="p-6 flex flex-col gap-4">
      {/* Cabeçalho da apresentação */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-app-text-label uppercase tracking-widest">
          Nova apresentação #{index + 1}
        </span>
        {podeRemover && (
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="flex items-center gap-1.5 text-[11px] text-app-text-label hover:text-rose-500 transition-colors font-medium"
          >
            <Trash2 size={13} />
            Remover
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Descrição da embalagem */}
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label required>Descrição da Embalagem</Label>
          <input
            type="text"
            value={ap.descricao}
            onChange={(e) => onUpdate(index, 'descricao', e.target.value)}
            placeholder="Ex: Galão 5L, Frasco 500ml, Rolo..."
            className={`input-base ${erros[`ap_${index}_descricao`] ? 'border-rose-400 focus:border-rose-400' : ''}`}
          />
          {erros[`ap_${index}_descricao`] && (
            <span className="text-rose-500 text-[11px]">{erros[`ap_${index}_descricao`]}</span>
          )}
        </div>

        {/* Quantidade unitária */}
        <div className="flex flex-col gap-1.5">
          <Label required>Quantidade Unitária</Label>
          <input
            type="number"
            step="0.0001"
            min="0.0001"
            value={ap.quantidade_unitaria}
            onChange={(e) => onUpdate(index, 'quantidade_unitaria', e.target.value)}
            placeholder="Ex: 5"
            className={`input-base ${erros[`ap_${index}_qtd`] ? 'border-rose-400' : ''}`}
          />
          {erros[`ap_${index}_qtd`] && (
            <span className="text-rose-500 text-[11px]">{erros[`ap_${index}_qtd`]}</span>
          )}
        </div>

        {/* Unidade */}
        <div className="flex flex-col gap-1.5">
          <Label required>Unidade de Medida</Label>
          <select
            value={ap.unidade_id}
            onChange={(e) => onUpdate(index, 'unidade_id', e.target.value)}
            className="input-base"
          >
            {unidades.map(u => (
              <option key={u.id} value={u.id}>
                {u.sigla} — {u.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Locais de estoque */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <MapPin size={13} className="text-app-text-label" />
          <Label required>Locais de Estoque</Label>
          <span className="text-[10px] text-app-text-label normal-case tracking-normal font-normal">
            — selecione os locais e informe a quantidade inicial
          </span>
        </div>

        <LocaisPicker
          locais={locais}
          selecionados={ap.locais}
          onToggle={(localId) => onToggleLocal(index, localId)}
          onUpdateQtd={(localId, qtd) => onUpdateLocalQtd(index, localId, qtd)}
          erro={erros[`ap_${index}_locais`]}
        />
      </div>
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
