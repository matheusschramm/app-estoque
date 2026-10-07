import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Filter, Package } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';
import { useLocal } from '../contexts/LocalContext';
import { normalizar, algumContem } from '../lib/texto';

function Catalog() {
  const navigate = useNavigate();
  const { localAtual, loadingLocal, podeEditarAtual } = useLocal();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    async function fetchData() {
      if (loadingLocal) return;
      if (!localAtual) {
        setData([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { data: estoquesData, error } = await supabase
          .from('estoques')
          .select(`
            id,
            quantidade_atual,
            estoque_minimo,
            apresentacoes (
              id,
              descricao,
              quantidade_unitaria,
              unidades (
                sigla
              ),
              produtos (
                id,
                nome,
                categorias (
                  nome
                )
              )
            ),
            locais (
              id,
              nome
            )
          `)
          .eq('local_id', localAtual.id);

        if (error) throw error;

        const formattedData = estoquesData.map(item => {
          const qtd    = Number(item.quantidade_atual);
          const minimo = Number(item.estoque_minimo);
          let status = 'emerald';
          if (qtd === 0) status = 'rose';
          else if (minimo > 0 && qtd <= minimo) status = 'amber';

          return {
            id: item.id,
            produtoId: item.apresentacoes?.produtos?.id ?? null,
            produto: item.apresentacoes?.produtos?.nome || 'Desconhecido',
            categoria: item.apresentacoes?.produtos?.categorias?.nome || 'Sem categoria',
            apresentacao: item.apresentacoes?.descricao || '',
            unidade: item.apresentacoes?.unidades?.sigla || '',
            local: item.locais?.nome || '',
            quantidade: qtd,
            status,
          };
        });

        setData(formattedData);
      } catch (error) {
        console.error('Erro ao buscar estoques:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [localAtual, loadingLocal]);

  /* Normaliza o termo uma vez, não a cada linha da tabela. */
  const termo = useMemo(() => normalizar(busca).trim(), [busca]);

  const dadosFiltrados = useMemo(
    () => data.filter(item =>
      !termo || algumContem(termo, item.produto, item.categoria, item.apresentacao, item.local)
    ),
    [data, termo]
  );

  const getStatusBadge = (status) => {
    switch (status) {
      case 'emerald':
        return (
          <span className="badge badge-emerald flex items-center gap-1.5 w-fit px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full badge-emerald-dot"></span>
            Disponível
          </span>
        );
      case 'amber':
        return (
          <span className="badge badge-amber flex items-center gap-1.5 w-fit px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full badge-amber-dot"></span>
            Baixo
          </span>
        );
      case 'rose':
        return (
          <span className="badge badge-rose flex items-center gap-1.5 w-fit px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full badge-rose-dot"></span>
            Em Falta
          </span>
        );
      default:
        return (
          <span className="badge badge-sky flex items-center gap-1.5 w-fit px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full badge-sky-dot"></span>
            Uso
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl mb-1">Catálogo de Estoque</h1>
          <p className="text-[13px] text-app-text-secondary">
            {localAtual
              ? <>Produtos e saldos do local <span className="font-semibold text-app-text">{localAtual.nome}</span>.</>
              : 'Selecione um local na barra superior para visualizar o estoque.'}
          </p>
        </div>
        <div className="flex gap-3">
          <button className="btn btn-secondary flex items-center gap-2">
            <Filter size={16} />
            <span>Filtros</span>
          </button>
          {/* Amarrado ao local da barra, não a "gerencia algum local": o usuário
              lê o Catálogo como o estoque do local selecionado, então oferecer
              cadastro aqui enquanto ele só visualiza este local seria promessa
              falsa — o produto acabaria em outro estoque. */}
          {podeEditarAtual && (
            <button
              className="btn btn-primary flex items-center gap-2"
              onClick={() => navigate('/cadastro-produto')}
            >
              <Plus size={16} />
              <span>Novo Produto</span>
            </button>
          )}
        </div>
      </header>

      <div className="card">
        <div className="p-4 border-b border-app-border-inner flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-label" size={16} />
            <input
              type="text"
              placeholder="Buscar por produto, categoria ou apresentação..."
              className="input-base w-full pl-9"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>

        <div className="table-wrapper border-none rounded-none">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Categoria</th>
                <th>Apresentação</th>
                <th>Unidade</th>
                <th>Qtd. Atual</th>
                <th>Status</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-app-text-secondary">Carregando dados...</td>
                </tr>
              ) : dadosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-app-text-secondary">
                    {localAtual ? 'Nenhum estoque encontrado neste local.' : 'Nenhum local selecionado.'}
                  </td>
                </tr>
              ) : (
                dadosFiltrados.map((item) => (
                  <tr
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => item.produtoId && navigate(`/produtos/${item.produtoId}`)}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-app-bg flex items-center justify-center text-app-text-label">
                          <Package size={16} />
                        </div>
                        <span className="font-bold">{item.produto}</span>
                      </div>
                    </td>
                    <td>
                      <span className="text-app-text-secondary text-[12px]">{item.categoria}</span>
                    </td>
                    <td>{item.apresentacao}</td>
                    <td>{item.unidade}</td>
                    <td className="font-bold">{item.quantidade}</td>
                    <td>{getStatusBadge(item.status)}</td>
                    <td className="text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); item.produtoId && navigate(`/produtos/${item.produtoId}`); }}
                        className="text-app-text-label hover:text-app-text font-semibold text-[12px] uppercase tracking-wide transition-colors"
                      >
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Catalog;
