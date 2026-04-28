# Guia de Edição — Agente Mobile Mercado

Este guia explica onde mexer no projeto para cada tipo de mudança, sem precisar de ajuda técnica para as tarefas do dia a dia.

---

## Publicar mudanças no ar (deploy)

Toda vez que editar um arquivo, você precisa rodar esses 3 comandos no terminal para as mudanças aparecerem no site:

```bash
git add .
git commit -m "Descreva o que você mudou"
git push
```

O Render detecta automaticamente e publica em alguns minutos.

---

## Cadastrar um novo estabelecimento

**Arquivo:** `src/config/dominios.ts`

Adicione uma linha em `DOMAIN_SLUGS`:
```ts
'nomedomercado': 'ID_DO_FIRESTORE',
```

O ID do Firestore é o código do documento do estabelecimento no Firebase Console.

Se quiser que o nome apareça diferente do que está no Firestore, adicione em `NOME_OVERRIDES`:
```ts
ID_DO_FIRESTORE: 'Nome que vai aparecer no app',
```

Se quiser usar um logo salvo localmente (pasta `public/logos/`), adicione em `LOGO_OVERRIDES`:
```ts
ID_DO_FIRESTORE: '/logos/nome-do-arquivo.svg',
```

Depois de editar, o estabelecimento fica acessível em:
- `nomedomercado.agentemercado.com.br`
- `agentemercado.com.br/nomedomercado`
- `agentemercado.onrender.com/nomedomercado`

---

## Mudar o nome de um estabelecimento

**Arquivo:** `src/config/dominios.ts`

Edite a linha correspondente em `NOME_OVERRIDES`. Exemplo:
```ts
XAXMOP6aweRbBAb0gUvU: 'Vidal Supermercados',
```

---

## Mudar o logo de um estabelecimento

**Arquivo:** `src/config/dominios.ts`

1. Coloque o arquivo de imagem na pasta `public/logos/`
2. Edite a linha em `LOGO_OVERRIDES`:
```ts
ID_DO_FIRESTORE: '/logos/nome-do-arquivo.png',
```

---

## Mudar os links de Política de Privacidade ou Termos de Uso

**Arquivos:**
- `src/components/Login/Login.tsx` — tela de login
- `src/components/PhoneAuthInline/PhoneAuthInline.tsx` — fluxo de autenticação no chat
- `src/components/Chat/AuthCheckboxCard.tsx` — card de aceite no chat

Procure por `href="https://www.mobilemercado.com.br/declaracao-de-privacidade"` e troque pela URL desejada.

---

## Mudar textos que o assistente fala

**Arquivo:** `src/app/[slug]/page.tsx`

Procure pelo texto que quer mudar (use Ctrl+F) e edite diretamente. Exemplos comuns:
- Mensagem de boas-vindas ao abrir o chat
- Mensagens de erro
- Texto do botão de envio

---

## Mudar o visual (cores, tamanhos, espaçamentos)

Cada componente tem seu próprio arquivo de estilo (`.module.css`) na mesma pasta:

| O que mudar | Arquivo de estilo |
|---|---|
| Header (topo do chat) | `src/components/Header/Header.module.css` |
| Tela de login | `src/components/Login/Login.module.css` |
| Tela de autenticação inline | `src/components/PhoneAuthInline/PhoneAuthInline.module.css` |
| Painel de configurações | `src/components/Header/SettingsPanel.module.css` |
| Modal de checkout | `src/components/CheckoutModal/CheckoutModal.module.css` |
| Card de boas-vindas | `src/components/Chat/WelcomeCard.module.css` |
| Barra de info (aberto/fechado, frete) | `src/components/Chat/InfoBar.module.css` |
| Estilo global (fontes, cores base) | `src/app/globals.css` |

---

## Mudar o título e favicon por estabelecimento

**Arquivo:** `src/app/[slug]/layout.tsx`

O título e o ícone da aba do navegador são definidos automaticamente a partir de `NOME_OVERRIDES` e `LOGO_OVERRIDES` em `dominios.ts`. Basta atualizar esses valores lá.

---

## Adicionar um novo domínio autorizado no Firebase

Quando cadastrar um novo estabelecimento com subdomínio, adicione o domínio no Firebase Console:

**Firebase Console → Authentication → Configurações → Domínios autorizados**

Adicione:
```
nomedomercado.agentemercado.com.br
```

E no **Google Cloud Console → reCAPTCHA Enterprise → sua chave → Domínios permitidos**, adicione o mesmo domínio.

---

## Estrutura resumida do projeto

```
src/
├── app/
│   ├── page.tsx              → Página inicial (lista de estabelecimentos)
│   ├── globals.css           → Estilos globais
│   ├── layout.tsx            → Layout raiz (título, favicon padrão)
│   └── [slug]/
│       ├── page.tsx          → Chat principal do agente (arquivo principal)
│       ├── layout.tsx        → Título e favicon por estabelecimento
│       ├── login/page.tsx    → Tela de login
│       └── admin/page.tsx    → Painel admin
│
├── components/
│   ├── Chat/                 → Cards e componentes do chat
│   ├── Header/               → Cabeçalho e painel de configurações
│   ├── Login/                → Tela de login
│   ├── PhoneAuthInline/      → Autenticação por telefone no chat
│   └── CheckoutModal/        → Modal de finalização de pedido
│
├── config/
│   └── dominios.ts           → CADASTRO DE ESTABELECIMENTOS (mais usado)
│
├── services/
│   └── firestore.ts          → Funções de busca no banco de dados
│
├── lib/
│   ├── buildSystemPrompt.ts  → Instruções do assistente de IA
│   ├── productSearch.ts      → Lógica de busca de produtos
│   └── validation.ts         → Validação de telefone, CPF, etc.
│
└── middleware.ts             → Redireciona subdomínios para o slug correto
```

---

## Tarefas mais comuns

| Quero... | Mexo em... |
|---|---|
| Cadastrar novo mercado | `src/config/dominios.ts` |
| Mudar nome do mercado | `src/config/dominios.ts` → `NOME_OVERRIDES` |
| Trocar logo do mercado | `src/config/dominios.ts` → `LOGO_OVERRIDES` |
| Mudar link da política de privacidade | `Login.tsx`, `PhoneAuthInline.tsx`, `AuthCheckboxCard.tsx` |
| Mudar cores/visual | arquivo `.module.css` do componente |
| Mudar texto do assistente | `src/app/[slug]/page.tsx` |
| Mudar estilo global | `src/app/globals.css` |
| Adicionar novo subdomínio | `dominios.ts` + Firebase Console + Google Cloud Console |
