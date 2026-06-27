# AGENT.md

Contexto rapido para proximos chats neste projeto.

## Projeto

App Next.js 15 + React 19 + TypeScript para um assistente de compras de supermercado. O usuario entra por um slug de estabelecimento, conversa com um agente, busca produtos no Firestore, monta carrinho e finaliza pedido. Tambem ha integracao com Safrapay, autenticacao Firebase, historico de conversa e push notifications.

## Comandos

- `npm run dev`: servidor local Next.js.
- `npm run build`: build de producao.
- `npm run lint`: ESLint.
- Deploy: Render usa `render.yaml` com `npm install && npm run build` e `npm start`.
- Deploy paralelo Firebase: `apphosting.yaml` prepara Firebase App Hosting sem alterar Render.
- `npm run firebase:init`: inicializa App Hosting localmente.
- `npm run firebase:create-backend`: cria backend App Hosting no projeto Firebase selecionado.
- `npm run firebase:deploy`: deploy pelo Firebase CLI.
- `.firebaserc` e local/ignorado; use `.firebaserc.example` como modelo quando o Project ID for conhecido.
- Segredos de producao devem ficar no Firebase Console/Secret Manager, nao no git.

## Arquivos principais

- `src/app/[slug]/page.tsx`: tela principal do chat. Arquivo grande; leia primeiro os trechos em torno de `enviarMensagem`.
- `src/lib/buildSystemPrompt.ts`: tipos do fluxo, estados do checkout e prompt principal do agente.
- `src/lib/parseAgentResponse.ts`: parser das tags do agente, como `[SHOW:id]`, `[ADD:id:qtd]`, `[SET_*]`, `[START_CHECKOUT]` e `[CONFIRM_ORDER]`.
- `src/lib/productSearch.ts`: busca local de produtos, normalizacao, tags, categorias, marcas, contextos e fallback.
- `src/lib/taskAgents.ts`: camada nova de pequenos agentes deterministicos. Ela orquestra intencao e descoberta de produtos antes da chamada OpenAI, sem criar varias chamadas de LLM por mensagem.
- `src/services/firestore.ts`: acesso ao Firestore, produtos, pedidos, carrinho, conversa, endereco salvo, configuracao da loja e push.
- `src/config/dominios.ts`: cadastro de slugs, companyIds, overrides de nome/logo e `COMPANY_DATA_SOURCE`.
- `src/components/CheckoutModal/*`: checkout visual, endereco, pagamento, Safrapay PIX/cartao.
- `src/lib/safrapay.ts` e `src/app/api/payment/safrapay/route.ts`: cliente e API de pagamento Safrapay.
- `src/lib/firebaseAdmin.ts`: inicializacao server-side do Firebase Admin. Aceita env/local JSON no Render e credencial automatica no Firebase App Hosting.
- `src/app/api/chat/route.ts`: chamada OpenAI streaming. Modelo atual: `gpt-4o-mini`.
- `src/app/api/transcribe/route.ts`: transcricao de audio.
- `src/app/api/push/*`: inscricao e notificacao push.
- `src/middleware.ts` e `next.config.ts`: rewrites por subdominio/slug.

## Fluxo do agente

1. `src/app/[slug]/page.tsx` recebe a mensagem em `enviarMensagem`.
2. O estado local (`wFlowState`, `wCart`, `wCustomerData`) espelha o React state para evitar closure velha.
3. Alguns casos sao resolvidos localmente antes da IA: checkout, endereco salvo, confirmacao de pedido, lista de compras, marca, categoria, continuar comprando, carrinho vazio e pedido minimo.
4. Para mensagens que ainda precisam de IA, `runTaskOrchestrator` classifica a tarefa e gera uma dica de prompt.
5. `runProductDiscoveryAgent` seleciona `produtosFoco`, `contextoDetectado` e `nivelConfianca`.
6. `buildSystemPrompt` monta o prompt com estado, carrinho, produtos foco, contexto, formas de pagamento e a dica de roteamento.
7. `/api/chat` faz streaming da resposta.
8. `parseAgentResponse` aplica as tags e devolve novo carrinho, novo estado, dados do cliente, cards e sinais de pedido/endereco.
9. O app sincroniza carrinho/conversa no Firestore e cria pedido quando necessario.

## Estrategia de pequenos agentes

A estrategia aprovada e hibrida para evitar gasto alto de tokens:

- Pequenos agentes deterministicos em codigo, nao varias chamadas OpenAI por mensagem.
- O orquestrador decide o tipo de tarefa.
- O especialista de produtos reduz o catalogo antes do prompt.
- A IA continua sendo chamada uma vez no fluxo normal.
- Subagentes com chamada LLM separada so devem ser adicionados para casos realmente dificeis, porque multiplicam custo e latencia.

Arquivo central: `src/lib/taskAgents.ts`.

## Estados importantes

Definidos em `FLOW_STATES`:

- `collecting_name`
- `collecting_cpf_onboarding`
- `browsing`
- `checking_saved_address`
- `collecting_street`
- `collecting_number`
- `collecting_neighborhood`
- `collecting_city`
- `collecting_state`
- `collecting_zipcode`
- `asking_save_address`
- `collecting_payment`
- `collecting_card_brand`
- `collecting_change`
- `collecting_cpf`
- `confirming_order`

Ao alterar checkout por chat, mantenha `parseAgentResponse.ts`, `buildSystemPrompt.ts` e `enviarMensagem` coerentes.

## Produtos e busca

`productSearch.ts` usa:

- `normalizar` para remover acentos e caixa.
- `filtrarProdutos` e `filtrarProdutosWordKeys` para score de busca.
- `detectarContexto` para situacoes como churrasco, natal, derivados do leite.
- `detectarBuscaPorMarca` e `buscarProdutosPorMarca` para marca.
- `detectarBuscaPorCategoria` e `buscarProdutosPorCategoria` para categoria.
- `produtoCobreTermos` para evitar cards irrelevantes.

Nao deixe a IA inventar produto. O prompt deve receber apenas candidatos reais.

## Firestore

Colecoes usadas:

- `estabelecimentos/{companyId}`
- `estabelecimentos/{companyId}/Products`
- `Users`
- `Users/{userId}/ShoppingCart/{companyId}/Items`
- `Users/{userId}/Addresses`
- `PurchaseRequests`
- `AgenteVendas/{userId}/conversas/{conversaId}/mensagens`
- `Agentes/AgenteVendas/ExemplosConversa`
- `AgenteVendas/{companyId}/capturasDeDados`
- `AgenteVendas/{companyId}/metricasDeCapturas/resumo`
- `AgenteVendas/{companyId}/notasEFeedbacks`

`COMPANY_DATA_SOURCE` em `dominios.ts` permite um estabelecimento usar dados de outro.

## Capturas De Dados Do Agente

Eventos sao registrados por `registrarCapturaDadosAgente` em `src/services/firestore.ts`.

- Eventos individuais: `AgenteVendas/{companyId}/capturasDeDados`
- Contadores por mercado: `AgenteVendas/{companyId}/metricasDeCapturas/resumo`
- Notas e feedbacks: `AgenteVendas/{companyId}/notasEFeedbacks`
- KPIs do gerenciador plus: `estabelecimentos/{companyId}/Stats/allTime`, `DailyStats/{dd-mm-aaaa}` e `MonthlyStats/{dd-mm-aaaa}`

Eventos que tambem alimentam os KPIs do gerenciador plus:

- `site_visit` incrementa `agentAppViewsCount`.
- `order_completed` incrementa `agentNewOrdersCount`.
- `order_canceled` incrementa `agentCanceledOrdersCount`.
- `response_time` atualiza `agentResponseTimeTotalMs`, `agentResponseTimeCount`, `agentAverageResponseTimeMs` e `agentLastResponseTimeMs`.

Pedidos criados pelo agente devem manter marcadores de origem (`origem: agente_ia`, `source/channel/purchaseOrigin: agent`, `agentOrder: true`, `createdByAgent: true`) para o gerenciador separar App x Agente.

Eventos atuais:

- `site_visit`: visita ao site.
- `entered_without_login`: usuario chegou sem login.
- `left_without_login`: usuario saiu sem logar.
- `logged_in`: usuario entrou e logou.
- `cart_filled`: usuario preencheu carrinho.
- `cart_not_completed`: usuario saiu com carrinho sem concluir pedido.
- `return_visit`: usuario voltou ao site depois da primeira visita.
- `return_second_visit`: voltou pela segunda vez.
- `return_tenth_visit`: voltou pela decima vez.
- `return_more_than_30_visits`: passou de 30 visitas.
- `search_performed`: usuario pesquisou um termo/produto.
- `search_no_results`: busca sem resultado.
- `product_shown`: card de produto exibido.
- `product_added`: produto adicionado ao carrinho.
- `checkout_started`: checkout aberto.
- `checkout_abandoned`: checkout fechado sem concluir pedido.
- `order_completed`: pedido concluido.
- `order_canceled`: pedido cancelado pelo fluxo do agente.
- `payment_error`: erro de pagamento.
- `minimum_order_block`: pedido minimo bloqueou finalizacao.
- `feedback_submitted`: nota ou feedback recebido.

Os eventos usam `eventId` deterministico e transacao Firestore para evitar incrementar contadores duplicados.
No Firestore, os documentos de captura usam campos em portugues: `idEvento`, `tipoEvento`, `estabelecimentoId`, `visitanteId`, `sessaoId`, `usuarioId`, `dados` e `criadoEm`.

## Safrapay

Variaveis relevantes:

- `SAFRAPAY_ENV`
- `SAFRAPAY_GATEWAY_URL`
- `SAFRAPAY_MERCHANT_ID`
- `SAFRAPAY_MERCHANT_TOKEN`
- `SAFRAPAY_WEBHOOK_SECRET`
- `FIREBASE_ADMIN_EMAIL`
- `FIREBASE_ADMIN_KEY`

A API resolve credenciais por estabelecimento via Firestore quando possivel e usa env como fallback. Neste projeto, o fluxo atual aceita PIX e cartao de credito; debito e bloqueado.

## Variaveis de ambiente

Veja `.env.example`. Principais:

- `OPENAI_API_KEY`
- `NEXT_PUBLIC_FIREBASE_*`
- `NEXT_PUBLIC_VOICE_ENABLED`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `NEXT_PUBLIC_DELIVERY_LIMIT_ENABLED`
- `NEXT_PUBLIC_DELIVERY_LIMIT_KM`

Nao exponha secrets em arquivos client-side. Variaveis `NEXT_PUBLIC_*` ficam no browser.

## Regras praticas para editar

- Prefira mudancas pequenas em volta do fluxo existente; `src/app/[slug]/page.tsx` e grande e sensivel.
- Para novas lojas, edite `src/config/dominios.ts` e, se necessario, Firebase Auth/dominos autorizados.
- Para visual, mexa no `.module.css` do componente correspondente.
- Para comportamento do agente, normalmente mexa em `taskAgents.ts`, `productSearch.ts`, `buildSystemPrompt.ts` e `parseAgentResponse.ts`.
- Para salvar dados, use funcoes de `src/services/firestore.ts` em vez de acesso espalhado.
- Rode `npm run lint` e, se possivel, `npm run build` antes de concluir.
