import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useLocal } from '../contexts/LocalContext';
import { Search, Download, Printer, Package } from 'lucide-react';
import { normalizar, algumContem } from '../lib/texto';

function formatarDataHora(d) {
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function RelatorioEstoque() {
  const { localAtual, loadingLocal } = useLocal();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca]     = useState('');

  useEffect(() => {
    async function fetchData() {
      if (loadingLocal) return;
      if (!localAtual) {
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data, error } = await supabase
        .from('estoques')
        .select(`
          id,
          quantidade_atual,
          apresentacoes (
            descricao,
            unidades ( sigla ),
            produtos ( nome )
          )
        `)
        .eq('local_id', localAtual.id);

      if (!error && data) {
        const formatado = data.map(item => ({
          id: item.id,
          produto: item.apresentacoes?.produtos?.nome || 'Desconhecido',
          apresentacao: item.apresentacoes?.descricao || '—',
          unidade: item.apresentacoes?.unidades?.sigla || '',
          quantidade: Number(item.quantidade_atual),
        }));
        formatado.sort((a, b) =>
          a.produto.localeCompare(b.produto, 'pt-BR') ||
          a.apresentacao.localeCompare(b.apresentacao, 'pt-BR')
        );
        setRows(formatado);
      }
      setLoading(false);
    }
    fetchData();
  }, [localAtual, loadingLocal]);

  /* Normaliza o termo uma vez, não a cada linha da tabela. */
  const termo = useMemo(() => normalizar(busca).trim(), [busca]);

  const filtrados = useMemo(
    () => rows.filter(r => !termo || algumContem(termo, r.produto, r.apresentacao)),
    [rows, termo]
  );

  const exportarCSV = () => {
    const cabecalho = ['Produto', 'Apresentação', 'Estoque atual', 'Unidade'];
    const linhas = filtrados.map(r => [
      r.produto,
      r.apresentacao,
      r.quantidade,
      r.unidade,
    ]);
    const escapar = (v) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cabecalho, ...linhas]
      .map(l => l.map(escapar).join(';'))
      .join('\r\n');
    // BOM para o Excel reconhecer acentuação UTF-8
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const nomeLocal = (localAtual?.nome || 'estoque').replace(/[^\w-]+/g, '_');
    const data = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `relatorio_estoque_${nomeLocal}_${data}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-5">

      <header className="flex justify-between items-end print:hidden">
        <div>
          <h1 className="text-2xl mb-0.5">Relatório de Estoque</h1>
          <p className="text-[13px] text-app-text-secondary">
            {localAtual
              ? <>Itens em estoque no local <span className="font-semibold text-app-text">{localAtual.nome}</span>.</>
              : 'Selecione um local na barra superior para gerar o relatório.'}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className="btn btn-secondary flex items-center gap-2"
            onClick={() => window.print()}
            disabled={!filtrados.length}
          >
            <Printer size={16} />
            <span>Imprimir</span>
          </button>
          <button
            className="btn btn-primary flex items-center gap-2"
            onClick={exportarCSV}
            disabled={!filtrados.length}
          >
            <Download size={16} />
            <span>Exportar CSV</span>
          </button>
        </div>
      </header>

      {/* Cabeçalho visível apenas na impressão */}
      <div className="hidden print:block mb-2">
        <h1 className="text-xl font-bold">Relatório de Estoque — {localAtual?.nome ?? ''}</h1>
        <p className="text-[12px] text-app-text-secondary">
          Gerado em {formatarDataHora(new Date())} · {filtrados.length} item(ns)
        </p>
      </div>

      {/* Filtro */}
      <div className="card p-4 print:hidden">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-label" size={14} />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Filtrar por produto ou apresentação..."
            className="input-base w-full pl-9 py-2 text-[12px]"
          />
        </div>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div className="table-wrapper border-none rounded-none">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Apresentação</th>
                <th className="text-right">Estoque atual</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="3" className="text-center py-10 text-app-text-secondary text-[13px]">
                    Carregando...
                  </td>
                </tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan="3" className="text-center py-10 text-app-text-secondary text-[13px]">
                    {localAtual ? 'Nenhum item em estoque neste local.' : 'Nenhum local selecionado.'}
                  </td>
                </tr>
              ) : (
                filtrados.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-app-bg flex items-center justify-center text-app-text-label shrink-0 print:hidden">
                          <Package size={14} />
                        </div>
                        <span className="font-semibold">{r.produto}</span>
                      </div>
                    </td>
                    <td className="text-app-text-secondary text-[12px]">{r.apresentacao}</td>
                    <td className="text-right font-bold">
                      {r.quantidade}
                      <span className="text-app-text-secondary font-normal text-[11px] ml-1">{r.unidade}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && filtrados.length > 0 && (
        <p className="text-[11px] text-app-text-label text-center print:hidden">
          {filtrados.length} item(ns) listado(s){busca ? ' (filtrado)' : ''}.
        </p>
      )}
    </div>
  );
}
