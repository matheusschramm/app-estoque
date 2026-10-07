/* Normalização de texto para busca.

   Mesma regra em todas as telas: ignora acento e caixa, e casa por pedaço
   em qualquer posição — "acucar" acha "AÇÚCAR", "cuca" também.

   NFD separa a letra do acento ("ç" vira "c" + cedilha) e o replace joga os
   acentos fora. Cobre todo o conjunto do português; o unaccent do Postgres,
   usado na busca do Histórico, chega ao mesmo resultado para essas letras.

   Vivia duplicado em Movimentacoes.jsx e CadastroProduto.jsx. Uma das
   cópias já foi corrompida uma vez (os escapes ̀ viraram caractere
   combinante literal na fonte), que é o argumento prático para ter um
   lugar só. */
export const normalizar = (s) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/* Casa um termo já normalizado contra vários campos de uma linha.
   O termo vem pronto de propósito: normalizá-lo aqui o recalcularia a cada
   linha da tabela. */
export const algumContem = (termoNormalizado, ...valores) =>
  valores.some(v => normalizar(v).includes(termoNormalizado));
