# Mapa do Projeto — Agente Mobile Mercado

> Guia completo para desenvolvedores que queiram entender, personalizar ou escalar o projeto.

---

## Visão Geral

**Tipo:** Aplicação Next.js 15 full-stack com backend Firebase
**Propósito:** Chatbot de vendas com IA para supermercados — conversa natural, carrinho de compras, checkout e gestão de pedidos
**Modelo de IA:** GPT-4o-mini (OpenAI) via streaming
**Multitenancy:** Um deploy atende múltiplos estabelecimentos via slug na URL (`/[slug]`)

---

## Estrutura de Diretórios

```
agente_mobile_mercado/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx                # Layout raiz — configura PWA, AuthProvider, fontes
│   │   ├── page.tsx                  # Página inicial (instruções de acesso)
│   │   ├── globals.css               # Estilos globais
│   │   ├── api/                      # Endpoints de API (server-side)
│   │   │   ├── chat/route.ts         # Streaming de chat com GPT-4o-mini
│   │   │   ├── transcribe/route.ts   # Transcrição de áudio (Whisper)
│   │   │   └── push/
│   │   │       ├── inscrever/route.ts   # Registrar dispositivo para push
│   │   │       └── notificar/route.ts   # Enviar notificação ao cliente
│   │   └── [slug]/                   # Rota dinâmica por estabelecimento
│   │       ├── page.tsx              # ★ Interface principal do chatbot
│   │       ├── login/page.tsx        # Tela de autenticação
│   │       └── admin/page.tsx        # Dashboard do lojista (pedidos)
│   │
│   ├── components/
│   │   ├── Header/
│   │   │   ├── Header.tsx            # Barra de navegação + menu + configurações
│   │   │   └── Header.module.css
│   │   └── Login/
│   │       ├── Login.tsx             # Formulário de login (SMS, Google, Apple)
│   │       └── Login.module.css
│   │
│   ├── lib/                          # Lógica de negócio central
│   │   ├── firebase.ts               # Inicialização do Firebase (auth, db, storage)
│   │   ├── buildSystemPrompt.ts      # ★ Construtor do prompt do agente + tipos principais
│   │   ├── parseAgentResponse.ts     # ★ Parser das tags do agente ([ADD], [SHOW], etc.)
│   │   ├── distancia.ts              # Validação de raio de entrega (Haversine)
│   │   ├── validation.ts             # Validação/sanitização (CPF, phone, CEP)
│   │   └── webpush.ts                # Envio de push notifications (VAPID)
│   │
│   ├── services/
│   │   └── firestore.ts              # ★ Todas as operações CRUD no Firestore
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx           # Provider do estado de autenticação Firebase
│   │
│   ├── config/
│   │   └── dominios.ts               # Mapeamento domínio → slug + whitelist de slugs
│   │
│   └── middleware.ts                 # Roteamento: bloqueia slugs não autorizados
│
├── public/                           # Assets estáticos (logos, ícones SVG)
├── db_json/                          # Dados de referência / testes (JSON)
├── scripts/
│   └── generate-vapid.js             # Gera chaves VAPID para push notifications
├── .env.example                      # Template de variáveis de ambiente
├── MAPA_DO_PROJETO.md                # Este arquivo
├── next.config.ts                    # Config Next.js (rewrites de domínio, imagens)
└── package.json
```

---

## Arquivos-Chave (★ os mais importantes)

### `src/app/[slug]/page.tsx` — Interface do Chatbot

O coração do projeto. Contém:

- **Máquina de estados** (`flowState`) com 15 estados de conversa
- **Gerenciamento do carrinho** (local + sincronização Firestore)
- **Busca contextual de produtos** com aliases, stopwords e categorias
- **Renderização das mensagens** com cards de produto em carrossel
- **Interceptores locais** (lista de compras, item único com quantidade)
- **Checkout inline** com coleta progressiva de dados (endereço, pagamento, CPF)
- **Criação de pedido** e confirmação visual

**Estados do fluxo (`FLOW_STATES`):**

| Estado | Descrição |
|--------|-----------|
| `collecting_name` | Coleta o nome do cliente no primeiro acesso |
| `browsing` | Estado principal: mostra produtos, gerencia carrinho |
| `checking_saved_address` | Confirma ou troca endereço salvo |
| `collecting_street` | Coleta rua |
| `collecting_number` | Coleta número |
| `collecting_neighborhood` | Coleta bairro |
| `collecting_city` | Coleta cidade |
| `collecting_state` | Coleta estado |
| `collecting_zipcode` | Coleta CEP |
| `asking_save_address` | Pergunta se salva o endereço |
| `collecting_payment` | Escolhe forma de pagamento |
| `collecting_card_brand` | Bandeira do cartão (se cartão) |
| `collecting_change` | Troco necessário (se dinheiro) |
| `collecting_cpf` | CPF para nota fiscal (opcional) |
| `confirming_order` | Revisão final antes de confirmar |

---

### `src/lib/buildSystemPrompt.ts` — Prompt do Agente

Gera dinamicamente o prompt do sistema enviado ao GPT com base no estado atual. Quanto mais preciso o prompt, melhor o comportamento do agente.

**Para customizar o comportamento do agente**, edite as seções:
- `stateBlock` — instrução específica por estado
- Regras gerais no final da função (o que o agente NUNCA deve fazer)
- Tags que o agente pode emitir

**Tipos exportados:**
- `Produto` — modelo de produto
- `CartItem` — item no carrinho (Produto + quantidade)
- `CustomerData` — dados coletados durante checkout
- `FlowState` — union type de todos os estados
- `FewShotExemplo` — exemplo de conversa para treinamento

---

### `src/lib/parseAgentResponse.ts` — Parser de Tags

Processa a resposta bruta do GPT e extrai comandos especiais. Cada tag modifica o estado da aplicação.

**Tags disponíveis:**

| Tag | Exemplo | Efeito |
|-----|---------|--------|
| `[SHOW:id]` | `[SHOW:abc123]` | Exibe card do produto |
| `[ADD:id:qty]` | `[ADD:abc123:2]` | Adiciona ao carrinho |
| `[REMOVE:id]` | `[REMOVE:abc123]` | Remove do carrinho |
| `[START_CHECKOUT]` | — | Inicia checkout |
| `[USE_SAVED_ADDRESS]` | — | Usa endereço salvo |
| `[NEW_ADDRESS]` | — | Coleta novo endereço |
| `[SET_STREET:valor]` | `[SET_STREET:Rua das Flores]` | Define rua |
| `[SET_NUMBER:valor]` | `[SET_NUMBER:123]` | Define número |
| `[SET_NEIGHBORHOOD:valor]` | — | Define bairro |
| `[SET_CITY:valor]` | — | Define cidade |
| `[SET_STATE:valor]` | — | Define estado |
| `[SET_ZIPCODE:valor]` | — | Define CEP |
| `[SET_PAYMENT:valor]` | `[SET_PAYMENT:Pix]` | Define pagamento |
| `[SET_CARD_BRAND:valor]` | `[SET_CARD_BRAND:Visa]` | Define bandeira |
| `[SET_CHANGE:valor]` | `[SET_CHANGE:R$50]` | Define troco |
| `[SET_CPF:valor]` | `[SET_CPF:none]` | Define CPF (ou none) |
| `[SET_NAME:valor]` | `[SET_NAME:João]` | Define nome do cliente |
| `[SET_SAVE_ADDRESS:sim]` | — | Salva endereço |
| `[CONFIRM_ORDER]` | — | Cria pedido no Firestore |
| `[CANCEL_CHECKOUT]` | — | Volta ao browsing |
| `[SUGGEST:t1,t2]` | `[SUGGEST:leite,queijo]` | Chips de sugestão |

---

### `src/services/firestore.ts` — Camada de Dados

Todas as interações com o Firestore passam por aqui. Para adicionar novos campos ou coleções, edite somente este arquivo.

**Estrutura do banco:**

```
Firestore
├── estabelecimentos/{companyId}
│   ├── name, logo, paymentMethods[]
│   └── Products/{productId}
│       ├── name, description, price
│       ├── category, categoryId, subcategory
│       ├── image, unityType, barCode
│       └── stock (-1=ilimitado, 0=esgotado, N=quantidade)
│
├── Users/{userId}
│   ├── userAuthId, nomeCompleto, cpf, telefone
│   ├── Addresses/{addressId}
│   ├── ShoppingCart/{companyId}/Items/{productId}
│   └── pushSubscription/default
│
├── PurchaseRequests/{orderId}
│   ├── orderNumber (6 dígitos), clientName, clientId
│   ├── total, currentPurchaseStatus
│   ├── address { street, number, neighborhood, city }
│   ├── productsCart [{ product, quantity }]
│   └── paymentMethod, cpf, createdAt
│
└── Agentes/AgenteVendas
    ├── {userId}/dados
    ├── {userId}/{conversaId}
    │   └── mensagens/{mensagemId}
    │       ├── role, content, timestamp
    │       ├── flowStateAntes, flowStateDepois
    │       └── tagsDetectadas[], produtosCardIds[]
    └── ExemplosConversa/{exemploId}
        └── mensagens [{ role, content }]
```

---

### `src/config/dominios.ts` — Multitenancy

Para adicionar um novo estabelecimento:

1. Adicione o slug do Firestore em `DOMAIN_SLUGS`:
   ```ts
   'meudominio.com.br': 'id_do_estabelecimento_no_firestore'
   ```
2. O slug é automaticamente adicionado à whitelist via `SLUGS_AUTORIZADOS`
3. Configure os rewrites em `next.config.ts` se necessário

---

### `src/middleware.ts` — Autorização de Rotas

Bloqueia slugs não cadastrados e redireciona para `/`. Para teste local, use sempre `/estabelecimento-teste`.

---

## Variáveis de Ambiente

Crie `.env.local` na raiz com:

```bash
# OpenAI (server-side apenas)
OPENAI_API_KEY=sk-...

# Firebase (público — prefixo NEXT_PUBLIC_)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=

# Funcionalidades opcionais
NEXT_PUBLIC_VOICE_ENABLED=false        # Habilita transcrição de voz
NEXT_PUBLIC_GUEST_MODE=false           # Modo teste sem login (usa Firebase anônimo)

# Push Notifications (gere com: node scripts/generate-vapid.js)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:seu@email.com.br

# Limite de raio de entrega
NEXT_PUBLIC_DELIVERY_LIMIT_ENABLED=false
NEXT_PUBLIC_DELIVERY_LIMIT_KM=10
```

---

## Como Personalizar o Agente

### Mudar o comportamento geral
Edite `src/lib/buildSystemPrompt.ts` — especialmente as **regras fixas** no final da função e os **blocos por estado** (`stateBlock`).

### Adicionar uma nova tag
1. Defina a tag no prompt em `buildSystemPrompt.ts`
2. Parse a tag em `parseAgentResponse.ts` (no switch/regex de tags)
3. Reaja a ela em `page.tsx` (após `parseAgentResponse()`)

### Adicionar um novo estado de fluxo
1. Adicione a string em `FLOW_STATES` em `buildSystemPrompt.ts`
2. Adicione o tipo em `FlowState`
3. Adicione o label em `ESTADO_LABEL` em `page.tsx`
4. Crie o `stateBlock` correspondente em `buildSystemPrompt.ts`
5. Defina a transição em `parseAgentResponse.ts`

### Adicionar um novo estabelecimento
1. Cadastre o estabelecimento no Firestore com seus produtos
2. Adicione o domínio/slug em `src/config/dominios.ts`
3. Configure os produtos com `stock`, `category`, `image`, `price`

### Adicionar forma de pagamento
1. Adicione no Firestore em `estabelecimentos/{id}/paymentMethods`
2. O agente lê e exibe automaticamente via `buscarFormasPagamento()`

### Personalizar cards de produto
Edite o JSX em `page.tsx` (seção `{/* Cards de produto */}`) e o CSS em `src/app/Agente/Agente.module.css` (seção `/* 9. CARDS DE PRODUTO */`).

---

## Fluxos Principais

### 1. Autenticação
```
Usuário acessa /{slug}
  → middleware valida slug
  → se não autenticado → redirect /{slug}/login
  → login por SMS, Google ou Apple
  → Firebase cria sessão
  → onAuthStateChanged: busca doc do usuário ou cria novo
  → se novo usuário → flowState = collecting_name
```

### 2. Conversa principal
```
[collecting_name]
  "Como quer ser chamado?" → [SET_NAME:João] → [browsing]

[browsing]
  "Quero leite" → busca produtos → [SHOW:id1][SHOW:id2] → cards aparecem
  Usuário clica + → [ADD:id1:1] → carrinho atualiza
  "Finalizar pedido" → [START_CHECKOUT] → [checking_saved_address ou collecting_street]

[collecting_*] (endereço)
  Pergunta → resposta → [SET_*:valor] → próximo campo → ... → [asking_save_address]

[collecting_payment]
  Mostra métodos → usuário escolhe → [SET_PAYMENT:Pix] → [collecting_cpf]

[confirming_order]
  Resumo completo → "Confirma?" → [CONFIRM_ORDER] → createOrder() → pedido criado
```

### 3. Modo convidado (`NEXT_PUBLIC_GUEST_MODE=true`)
```
signInAnonymously(auth)
  → onAuthStateChanged detecta usuário anônimo
  → cria doc em Users/{uid} com nomeCompleto: 'Convidado'
  → flowState = browsing (sem coleta de nome)
  → todas operações Firestore funcionam normalmente
```

### 4. Notificações de entrega (admin)
```
Lojista acessa /{slug}/admin
  → lista pedidos via buscarPedidosPorEstabelecimento()
  → clica em pedido → modal
  → escolhe tipo: "entregador saiu" ou "chegando"
  → POST /api/push/notificar
  → busca pushSubscription do cliente no Firestore
  → envia via web-push (VAPID)
  → atualiza status do pedido
```

---

## API Endpoints

| Endpoint | Método | Payload | Retorno |
|----------|--------|---------|---------|
| `/api/chat` | POST | `{ messages[], systemPrompt }` | Stream SSE de texto |
| `/api/transcribe` | POST | FormData com `audio` | `{ text: string }` |
| `/api/push/inscrever` | POST | `{ userId, subscription }` | `{ success: true }` |
| `/api/push/notificar` | POST | `{ orderId, userId, type, etaMinutes? }` | `{ success: true }` |

---

## Tecnologias Utilizadas

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| Next.js | 15.5 | Framework full-stack |
| React | 19 | UI |
| TypeScript | 5 | Tipagem |
| Firebase Auth | 12 | Autenticação (SMS, Google, Apple, anônimo) |
| Firestore | 12 | Banco de dados NoSQL em tempo real |
| Firebase Storage | 12 | Imagens dos produtos |
| OpenAI GPT-4o-mini | latest | Modelo de linguagem do agente |
| OpenAI Whisper | latest | Transcrição de voz |
| web-push | 3.6 | Notificações push (VAPID) |
| lucide-react | 0.54 | Ícones |
| CSS Modules | — | Estilos isolados por componente |

---

## Deploy (Render)

1. Conecte o repositório GitHub ao Render
2. Build command: `npm install; npm run build`
3. Start command: `npm start`
4. Adicione todas as variáveis de ambiente no painel do Render
5. Configure domínios customizados em **Settings → Custom Domains**
6. No Firebase Console:
   - Adicione o domínio em **Authentication → Authorized domains**
   - Ative os provedores: Phone, Google, Apple, **Anonymous**
   - Configure regras do Firestore para permitir usuários autenticados

---

## Pontos de Extensão Futuros

- **Novo canal** (WhatsApp, Instagram): substituir `page.tsx` por um webhook que use `buildSystemPrompt` + `parseAgentResponse` — a lógica de negócio já está desacoplada
- **Mais idiomas**: traduzir os blocos de texto em `buildSystemPrompt.ts`
- **Painel de analytics**: os dados já estão em `Agentes/AgenteVendas/{userId}/{conversaId}/mensagens`
- **Recomendação personalizada**: usar histórico de pedidos de `PurchaseRequests` para few-shot dinâmico
- **Múltiplos agentes por estabelecimento**: parametrizar `buildSystemPrompt` com perfis diferentes
- **Catálogo em tempo real**: já usa Firestore — basta atualizar `stock` nos produtos
