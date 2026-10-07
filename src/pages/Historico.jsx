import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useLocal } from '../contexts/LocalContext';
import { useAuth } from '../contexts/AuthContext';
import { Search, ArrowDownCircle, ArrowUpCircle, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { ConfirmDialog, traduzErro } from '../components/TabelaCrud';
import { useToast } from '../lib/toast';
import { normalizar } from '../lib/texto';

const PAGE_SIZE = 20;

/* Valor sentinela do <select> de motivo. Não pode ser '' porque isso já
   significa "todos", nem um código real, porque o alvo é motivo nulo. */
const SEM_MOTIVO = '__sem_motivo__';

function TipoBadge({ tipo }) {
  if (tipo === 'entrada') {
    return (
      <span className="badge badge-emerald flex items-center gap-1.5 w-fit px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide">
        <ArrowDownCircle size={12} />
        Entrada
      </span>
    );
  }
  return (
    <span className="badge badge-rose flex items-center gap-1.5 w-fit px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide">
      <ArrowUpCircle size={12} />
      Saída
    </span>
  );
}

function formatarData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* Descreve a consequência antes de confirmar. Uma pergunta só com "tem
   certeza?" não deixa o admin perceber que o saldo do local também muda. */
function mensagemExclusao(r) {
  const qtd = Number(r.quantidade);
  const emb = qtd === 1 ? 'embalagem' : 'embalagens';
  const acao = r.tipo === 'entrada' ? 'entrada' : 'saída';
  const efeito = r.tipo === 'entrada' ? 'reduzido' : 'aumentado';
  return `Excluir esta ${acao} de ${qtd} ${emb} de ${r.produto} (${r.apresentacao})? `
    + `O saldo em ${r.local} será ${efeito} em ${qtd} ${emb}, e a movimentação sai `
    + `do histórico permanentemente.`;
}

export default function Historico() {
  const { localAtual, loadingLocal } = useLocal();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [pagina, setPagina]     = useState(0);
  const [confirmacao, setConfirmacao] = useState(null);

  /* filtros */
  const [busca, setBusca]       = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroMotivo, setFiltroMotivo] = useState('');
  const [filtroInicio, setFiltroInicio] = useState('');
  const [filtroFim, setFiltroFim]       = useState('');

  /* Opções do filtro de motivo. Vêm da tabela, e não de um allowlist como na
     tela de Movimentações: aqui o objetivo é achar o que já foi gravado, o que
     inclui os motivos que o sistema gera sozinho (ajuste, saldo_inicial) e que
     o usuário nunca escolhe à mão. */
  const [motivos, setMotivos] = useState([]);

  useEffect(() => {
    supabase
      .from('motivos_movimentacao')
      .select('codigo, descricao')
      .order('descricao')
      .then(({ data }) => { if (data) setMotivos(data); });
  }, []);

  const fetchHistorico = useCallback(async () => {
    if (loadingLocal) return;
    if (!localAtual) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);

    /* Colunas explícitas em vez de '*': a view tem a coluna "busca", que só
       serve para o filtro abaixo e não precisa vir para o navegador. */
    let query = supabase
      .from('vw_auditoria_movimentacoes')
      .select(
        'id, data, tipo, quantidade, unidade, motivo_descricao, produto, apresentacao, local, usuario',
        { count: 'exact' }
      )
      .eq('local_id', localAtual.id)
      .order('data', { ascending: false })
      .range(pagina * PAGE_SIZE, pagina * PAGE_SIZE + PAGE_SIZE - 1);

    if (filtroTipo)   query = query.eq('tipo', filtroTipo);
    /* motivo_id é anulável, e a tabela mostra "—" nesses casos. Sem a opção
       SEM_MOTIVO não haveria como isolar justamente essas linhas. */
    if (filtroMotivo === SEM_MOTIVO) query = query.is('motivo', null);
    else if (filtroMotivo)           query = query.eq('motivo', filtroMotivo);
    if (filtroInicio) query = query.gte('data', new Date(filtroInicio).toISOString());
    if (filtroFim)    query = query.lte('data', new Date(filtroFim + 'T23:59:59').toISOString());
    /* O filtro bate na coluna "busca" da view, que já vem sem acento e em
       maiúsculas (produto + apresentação + usuário). Por isso o termo também
       é normalizado antes de sair daqui: as duas pontas têm que combinar.

       Era um .or() com dois ilike, e vírgula ou parêntese no texto quebravam
       a sintaxe do .or() do PostgREST — a busca falhava calada. Havia um
       replace arrancando esses caracteres do que o usuário digitava. Com uma
       coluna só não há .or() para quebrar, e nada precisa ser arrancado. */
    const termo = normalizar(busca).trim();
    if (termo) query = query.ilike('busca', `%${termo}%`);

    const { data, count, error } = await query;
    if (!error) {
      setRows(data ?? []);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [pagina, filtroTipo, filtroMotivo, filtroInicio, filtroFim, busca, localAtual, loadingLocal]);

  useEffect(() => { fetchHistorico(); }, [fetchHistorico]);

  /* resetar página ao mudar filtros ou local */
  useEffect(() => { setPagina(0); }, [filtroTipo, filtroMotivo, filtroInicio, filtroFim, busca, localAtual]);

  /* A exclusão apaga a linha do histórico; o saldo é devolvido pelo trigger
     tg_reverte_estoque, não por uma segunda chamada daqui — se fosse em duas
     etapas, uma falha na segunda deixaria o estoque errado. */
  const excluir = (r) => {
    setConfirmacao({
      mensagem: mensagemExclusao(r),
      onConfirm: async () => {
        setConfirmacao(null);

        /* O .select() existe porque o RLS recusa DELETE em silêncio: sem ele o
           PostgREST devolve sucesso com zero linhas e a tela mentiria. */
        const { data, error } = await supabase
          .from('movimentacoes')
          .delete()
          .eq('id', r.id)
          .select('id');

        if (error) {
          /* O trigger levanta mensagem própria em português (saldo negativo);
             traduzErro só entra se vier erro de transporte. */
          toast.erro(error.message || traduzErro(error));
          return;
        }
        if (!data || data.length === 0) {
          toast.erro('Nada foi excluído — apenas administradores podem excluir movimentações.');
          return;
        }

        toast.sucesso('Movimentação excluída e saldo corrigido.');

        /* Era a única linha da página: volta uma, senão o admin fica olhando
           uma página vazia. Mudar a página já dispara o refetch pelo efeito. */
        if (rows.length === 1 && pagina > 0) setPagina(p => p - 1);
        else fetchHistorico();
      },
    });
  };

  const totalPaginas = Math.ceil(total / PAGE_SIZE);
  const totalColunas = isAdmin ? 9 : 8;

  return (
    <div className="flex flex-col gap-5">

      <header>
        <h1 className="text-2xl mb-0.5">Histórico</h1>
        <p className="text-[13px] text-app-text-secondary">
          {localAtual
            ? <>Movimentações registradas em <span className="font-semibold text-app-text">{localAtual.nome}</span>.</>
            : 'Selecione um local na barra superior para ver o histórico.'}
        </p>
      </header>

      {/* Filtros */}
      <div className="card p-4 flex flex-wrap gap-3 items-end">
        {/* Busca */}
        <div className="flex flex-col gap-1 flex-1 min-w-48">
          <label className="text-[10px] font-bold text-app-text-label uppercase tracking-widest">
            Buscar
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-label" size={14} />
            <input
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Produto, apresentação ou usuário..."
              className="input-base w-full pl-8 py-2 text-[12px]"
            />
          </div>
        </div>

        {/* Tipo */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-app-text-label uppercase tracking-widest">Tipo</label>
          <select
            value={filtroTipo}
            onChange={e => setFiltroTipo(e.target.value)}
            className="input-base py-2 text-[12px]"
          >
            <option value="">Todos</option>
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
          </select>
        </div>

        {/* Motivo */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-app-text-label uppercase tracking-widest">Motivo</label>
          <select
            value={filtroMotivo}
            onChange={e => setFiltroMotivo(e.target.value)}
            className="input-base py-2 text-[12px]"
          >
            <option value="">Todos</option>
            {motivos.map(m => (
              <option key={m.codigo} value={m.codigo}>{m.descricao}</option>
            ))}
            <option value={SEM_MOTIVO}>Sem motivo</option>
          </select>
        </div>

        {/* Data início */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-app-text-label uppercase tracking-widest">De</label>
          <input
            type="date"
            value={filtroInicio}
            onChange={e => setFiltroInicio(e.target.value)}
            className="input-base py-2 text-[12px]"
          />
        </div>

        {/* Data fim */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-app-text-label uppercase tracking-widest">Até</label>
          <input
            type="date"
            value={filtroFim}
            onChange={e => setFiltroFim(e.target.value)}
            className="input-base py-2 text-[12px]"
          />
        </div>

        {/* Limpar filtros */}
        {(busca || filtroTipo || filtroMotivo || filtroInicio || filtroFim) && (
          <button
            className="btn btn-secondary text-[12px] py-2 self-end"
            onClick={() => {
              setBusca(''); setFiltroTipo(''); setFiltroMotivo('');
              setFiltroInicio(''); setFiltroFim('');
            }}
          >
            Limpar
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        {confirmacao && (
          <ConfirmDialog
            mensagem={confirmacao.mensagem}
            onConfirm={confirmacao.onConfirm}
            onCancel={() => setConfirmacao(null)}
          />
        )}
        <div className="table-wrapper border-none rounded-none">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Produto</th>
                <th>Apresentação</th>
                <th>Qtd</th>
                <th>Unidade</th>
                <th>Motivo</th>
                <th>Usuário</th>
                {isAdmin && <th className="text-right w-16">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={totalColunas} className="text-center py-10 text-app-text-secondary text-[13px]">
                    Carregando...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={totalColunas} className="text-center py-10 text-app-text-secondary text-[13px]">
                    Nenhuma movimentação encontrada neste local.
                  </td>
                </tr>
              ) : (
                rows.map(r => (
                  <tr key={r.id}>
                    <td className="text-[12px] whitespace-nowrap">{formatarData(r.data)}</td>
                    <td><TipoBadge tipo={r.tipo} /></td>
                    <td className="font-semibold">{r.produto}</td>
                    <td className="text-app-text-secondary text-[12px]">{r.apresentacao}</td>
                    <td className="font-bold">{Number(r.quantidade)}</td>
                    <td className="text-[12px] text-app-text-secondary">{r.unidade}</td>
                    <td className="text-[12px]">{r.motivo_descricao ?? '—'}</td>
                    <td className="text-[12px] text-app-text-secondary">{r.usuario}</td>
                    {isAdmin && (
                      <td className="text-right">
                        <button
                          onClick={() => excluir(r)}
                          title="Excluir movimentação"
                          className="p-1.5 rounded-lg hover:bg-rose-50 text-app-text-label hover:text-rose-500 transition-colors print:hidden"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPaginas > 1 && (
          <div className="px-4 py-3 border-t border-app-border-inner flex items-center justify-between">
            <span className="text-[12px] text-app-text-secondary">
              {total} registro{total !== 1 ? 's' : ''} — página {pagina + 1} de {totalPaginas}
            </span>
            <div className="flex gap-2">
              <button
                className="btn btn-secondary py-1.5 px-3 text-[12px]"
                disabled={pagina === 0}
                onClick={() => setPagina(p => p - 1)}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                className="btn btn-secondary py-1.5 px-3 text-[12px]"
                disabled={pagina >= totalPaginas - 1}
                onClick={() => setPagina(p => p + 1)}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
