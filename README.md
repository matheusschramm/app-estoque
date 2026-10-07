# React + Vite

## Como rodar

Pré-requisitos: Node.js 20.19+ (ou 22.12+) e um projeto no [Supabase](https://supabase.com).

### 1. Banco de dados

No SQL Editor do Supabase, rode:

1. `estoque_schema_normalizado.sql` — cria tabelas, views, funções, policies, dados de
   referência e o usuário admin inicial.
2. `seed_demo.sql` (opcional) — produtos e locais fictícios para ter o que ver nas telas.
   **Só em banco de testes.**

O schema já inclui todas as migrações. Os arquivos em `migracoes/` e
`migracao_ajuste_estoque.sql` servem apenas para atualizar bancos criados com versões
antigas do schema — num banco novo, não rode.

Login inicial: `admin@estoque.com` / `estoque`. Troque a senha depois do primeiro acesso.

### 2. Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha com a URL e a chave **anon** do projeto
(Supabase > Project Settings > API).

### 3. App

```bash
npm install
npm run dev
```

O app abre em http://localhost:5173.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
