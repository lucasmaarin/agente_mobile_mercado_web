// ============================================================
// TIPOS
// ============================================================

export const FLOW_STATES = {
  COLLECTING_NAME:           'collecting_name',
  BROWSING:                  'browsing',
  CHECKING_SAVED_ADDRESS:    'checking_saved_address',
  COLLECTING_STREET:         'collecting_street',
  COLLECTING_NUMBER:         'collecting_number',
  COLLECTING_NEIGHBORHOOD:   'collecting_neighborhood',
  COLLECTING_CITY:           'collecting_city',
  COLLECTING_STATE:          'collecting_state',
  COLLECTING_ZIPCODE:        'collecting_zipcode',
  ASKING_SAVE_ADDRESS:       'asking_save_address',
  COLLECTING_PAYMENT:        'collecting_payment',
  COLLECTING_CARD_BRAND:     'collecting_card_brand',
  COLLECTING_CHANGE:         'collecting_change',
  COLLECTING_CPF:            'collecting_cpf',
  CONFIRMING_ORDER:          'confirming_order',
} as const;

export type FlowState = typeof FLOW_STATES[keyof typeof FLOW_STATES];

export interface Produto {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  categoryId: string;
  subcategory: string;
  subcategoryId: string;
  image: string | null;
  unityType: string;
  barCode: string;
  stock: number;
}

export interface CartItem {
  id: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  image: string | null;
  unityType: string;
  barCode: string;
}

export interface CustomerData {
  name?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  uf?: string;
  zipCode?: string;
  paymentType?: string;
  cardBrand?: string;
  changeAmount?: string;
  cpf?: string;
}

export interface EnderecoSalvo {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
}

// ============================================================
// FEW-SHOT (exemplos de conversa para treino de comportamento)
// ============================================================

export interface FewShotExemplo {
  mensagens: { role: 'user' | 'assistant'; content: string }[];
}

// ============================================================
// BUILD SYSTEM PROMPT
// ============================================================

export function buildSystemPrompt(
  produtosFoco: Produto[],
  indiceCategoria: string,
  cart: CartItem[],
  flowState: FlowState,
  customerData: CustomerData,
  nomeCliente: string = 'Cliente',
  enderecoSalvo: EnderecoSalvo | null = null,
  deliveryPrice: number = 0,
  fewShotExemplos: FewShotExemplo[] = [],
  nomeEstabelecimento: string = '',
  formasPagamento: string[] = []
): string {
  const nomeSupermercado = nomeEstabelecimento || 'Mobile Mercado';
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const total     = cartTotal + deliveryPrice;

  const cartLine = cart.length > 0
    ? `CARRINHO: ${cart.map(i => `${i.quantity}x${i.name}(R$${(i.price*i.quantity).toFixed(2)})`).join(',')} | Total:R$${total.toFixed(2)}`
    : '';

  let secaoProdutos = '';
  if (flowState === FLOW_STATES.BROWSING) {
    const listaProdutos = produtosFoco.length > 0
      ? produtosFoco.map((p, i) => {
          const stockTag = p.stock === 0 ? ' ❌ESGOTADO' : (p.stock >= 1 && p.stock < 10) ? ` ⚠️restam:${p.stock}` : '';
          return `${i + 1}. [${p.id}] ${p.name} — R$${p.price.toFixed(2)}${stockTag}`;
        }).join('\n')
      : '(nenhum produto encontrado para esta busca)';
    secaoProdutos = `\nCATEGORIAS: ${indiceCategoria}\nPRODUTOS (os [ID] são internos — NÃO mostre ao cliente; use nas tags ADD e SHOW):\n${listaProdutos}`;
  }

  let secaoExemplos = '';
  if (fewShotExemplos.length > 0) {
    const blocos = fewShotExemplos.map(ex =>
      ex.mensagens.map(m => `[${m.role === 'user' ? 'user' : 'assistant'}]: ${m.content}`).join('\n')
    ).join('\n---\n');
    secaoExemplos = `\nEXEMPLOS:\n${blocos}`;
  }

  let stateBlock = '';

  if (flowState === FLOW_STATES.COLLECTING_NAME) {
    stateBlock = `TAREFA: boas-vindas e coletar o nome do cliente.
Mensagem: "Olá! Seja bem-vindo ao ${nomeSupermercado}! 😊 Como você gostaria de ser chamado?"
Quando o cliente responder: emita [SET_NAME:nome_exato]
PROIBIDO: falar sobre produtos, promoções ou qualquer outra coisa antes de coletar o nome.`;
  } else if (flowState === FLOW_STATES.BROWSING) {
    stateBlock = `MODO: navegação

━━ TAGS OBRIGATÓRIAS ━━
[SHOW:ID]    → use após CADA produto citado ou listado → exibe o card visual
[ADD:ID:QTD] → use ao adicionar → sem essa tag o item NÃO entra no carrinho
[REMOVE:ID]  → remove do carrinho
NUNCA exiba [ID] no texto — são internos.

━━ COMO ATENDER ━━

Responda SOMENTE ao que o cliente pediu. Não faça recomendações proativas.
• Se o cliente pedir um produto específico → mostre APENAS os produtos da lista que correspondem ao pedido
• Se o cliente pedir uma categoria ("algo doce", "bebidas") → mostre os disponíveis da lista nessa categoria
• Se o cliente descrever uma situação ("churrasco", "café da manhã") → pergunte "O que você precisa?" antes de mostrar produtos
• ❌ NUNCA mostre produtos que o cliente não pediu
• ❌ NUNCA sugira combinações ou complementos sem o cliente pedir

SEMPRE use [SHOW:ID] após cada produto que mencionar.

━━ AÇÕES DO SISTEMA ━━
• Mostrar produto:       [SHOW:ID]
• Adicionar ao carrinho: [ADD:ID:QTD]     ← sem essa tag o item NÃO entra no carrinho
• Remover do carrinho:   [REMOVE:ID]
• Iniciar pagamento:     [START_CHECKOUT]

❌ NUNCA exiba o [ID] no texto — são internos.
❌ NUNCA escreva "adicionei", "coloquei" ou qualquer confirmação de adição — só emita as tags, o card já é o feedback visual.
❌ NUNCA invente produtos fora da lista.
❌ NUNCA liste com numeração (1. 2. 3.) nem pergunte "qual você quer?" — o cliente usa o botão '+'.
❌ NUNCA use [SHOW:ID] sem o cliente ter pedido um produto específico — não recomende espontaneamente.

━━ SITUAÇÕES COMUNS ━━
• Cliente pede produto → responda com UMA frase curta + [SHOW:id1] [SHOW:id2] para cada produto encontrado. NUNCA escreva nome, preço ou descrição do produto no texto — o card já exibe tudo.
• Cliente envia lista de compras → para cada item encontrado emita apenas [SHOW:ID]. Resposta: "Aqui está o que encontrei! Para adicionar é só clicar no '+'. [SHOW:id1] [SHOW:id2] ..." — SEM texto listando nomes, preços ou categorias.
• Cliente diz que tem uma lista de compras (sem mandar) → pergunte "Me manda a lista que eu adiciono tudo pra você! 😊" — NÃO mostre produtos antes de receber a lista
• Cliente diz que quer fazer um novo pedido / recomeçar → pergunte "Claro! O que você vai precisar hoje?" — NÃO mostre produtos antes de o cliente pedir
• Cliente descreve situação sem pedir produto específico → pergunte "O que você precisa?" para entender o que deseja
• Cliente quer adicionar → emita APENAS [ADD:ID:QTD][SHOW:ID] para cada item, SEM texto de confirmação — o sistema já exibe o card
• "adiciona tudo" / "quero todos" → emita [ADD:ID:QTD][SHOW:ID] para cada produto mostrado
• Escolha por número ("quero o 1") → identifique pela posição da listagem anterior → [ADD:ID:1][SHOW:ID]
• Produto fora da lista ou lista vazia → "Infelizmente não temos [produto] em estoque no momento." — NÃO sugira alternativas, NÃO mostre outros produtos
• Produto com ❌ESGOTADO → informe que está sem estoque no momento. NÃO use [SHOW:ID] nem [ADD:ID:QTD] para produtos esgotados
• Preço → informe o valor exato da lista + [SHOW:ID]
• Estoque ⚠️restam:N → avise "Só restam N unidades! 🔥"
• Cliente quer remover → [REMOVE:ID]
• Carrinho ("o que tem no carrinho?") → responda com base no CARRINHO (sem ADD/SHOW)
• Formas de pagamento → informe: "Aceitamos: ${formasPagamento.length > 0 ? formasPagamento.join(', ') : 'Pix, Dinheiro, Cartão de Crédito e Cartão de Débito'}."
• Finalizar / pagar → [START_CHECKOUT] ← o sistema cuida do restante, NUNCA peça endereço aqui
• Cumprimento puro → responda brevemente e pergunte o que precisa
• Pergunta fora do escopo → responda com bom humor, relacione à compra, redirecione. Ex: "Previsão do tempo? Se vai chover eu já separo a sopa quente! ☔ O que você precisa hoje?"`;

  } else if (flowState === FLOW_STATES.CHECKING_SAVED_ADDRESS) {
    if (enderecoSalvo) {
      stateBlock = `VERIFICANDO ENDEREÇO SALVO:
Endereço salvo: ${enderecoSalvo.street}, ${enderecoSalvo.number} — ${enderecoSalvo.neighborhood}, ${enderecoSalvo.city}/${enderecoSalvo.state} — CEP ${enderecoSalvo.zipCode}
Pergunte ao cliente se deseja usar este endereço ou informar um novo:
  [USE_SAVED_ADDRESS] → usar o endereço salvo (avança direto para pagamento)
  [NEW_ADDRESS]       → informar novo endereço (inicia coleta de rua)`;
    } else {
      stateBlock = `COLETANDO: rua/avenida\nQuando informar: [SET_STREET:valor]`;
    }

  } else if (flowState === FLOW_STATES.ASKING_SAVE_ADDRESS) {
    stateBlock = `ENDEREÇO JÁ COLETADO COMPLETAMENTE — NÃO peça mais nenhum dado de endereço:
Rua: ${customerData.street || '?'} | Nº: ${customerData.number || '?'} | Bairro: ${customerData.neighborhood || '?'} | Cidade: ${customerData.city || '?'} | Estado: ${customerData.state || '?'} | CEP: ${customerData.zipCode || '?'}

TAREFA: perguntar se o cliente quer salvar este endereço para próximas compras.
❌ PROIBIDO pedir rua, número, bairro, cidade, CEP ou "endereço completo" — tudo já foi coletado.
Pergunte: "Deseja salvar este endereço para suas próximas compras? 📍"
  [SET_SAVE_ADDRESS:sim] → salvar
  [SET_SAVE_ADDRESS:nao] → não salvar`;

  } else if (flowState === FLOW_STATES.COLLECTING_STREET) {
    stateBlock = `TAREFA: perguntar a rua/avenida de entrega.
Pergunta: "Qual é a rua/avenida?"
Quando o cliente responder: emita [SET_STREET:resposta_exata] — aceite qualquer valor sem questionar.
PROIBIDO: validar, perguntar "você quis dizer X?", pedir outros dados.`;

  } else if (flowState === FLOW_STATES.COLLECTING_NUMBER) {
    stateBlock = `TAREFA: perguntar o número do imóvel.
Pergunta: "Qual é o número?"
Quando o cliente responder: emita [SET_NUMBER:resposta_exata] — aceite qualquer valor sem questionar.
PROIBIDO: validar, pedir outros dados.`;

  } else if (flowState === FLOW_STATES.COLLECTING_NEIGHBORHOOD) {
    stateBlock = `TAREFA: perguntar o bairro.
Pergunta: "Qual é o bairro?"
Quando o cliente responder: emita [SET_NEIGHBORHOOD:resposta_exata] — aceite qualquer valor sem questionar.
PROIBIDO: validar, pedir outros dados.`;

  } else if (flowState === FLOW_STATES.COLLECTING_CITY) {
    stateBlock = `TAREFA: perguntar a cidade.
Pergunta: "Qual é a cidade?"
Quando o cliente responder: emita [SET_CITY:resposta_exata] — aceite qualquer valor sem questionar.
PROIBIDO: validar, pedir estado/UF, pedir CEP, pedir qualquer outro dado além da cidade.`;

  } else if (flowState === FLOW_STATES.COLLECTING_STATE) {
    stateBlock = `TAREFA: perguntar o estado (UF) de entrega.
Pergunta: "Qual é o estado? (ex: RS, SP, RJ…)"
Quando o cliente responder: emita [SET_STATE:resposta_exata] — aceite sigla ou nome completo sem questionar.
PROIBIDO: validar, pedir outros dados.`;

  } else if (flowState === FLOW_STATES.COLLECTING_ZIPCODE) {
    stateBlock = `TAREFA: perguntar APENAS o CEP (código postal).
Pergunta EXATA: "Qual é o CEP?"
Quando o cliente responder: emita [SET_ZIPCODE:resposta_exata] com exatamente o que o cliente digitou.
PROIBIDO: perguntar estado, UF, bairro, cidade ou qualquer outro dado além do CEP.
PROIBIDO: validar ou corrigir o formato do CEP.`;

  } else if (flowState === FLOW_STATES.COLLECTING_CARD_BRAND) {
    stateBlock = `TAREFA: perguntar a bandeira do cartão.
Pergunta: "Qual a bandeira do cartão? (Visa, Mastercard, Elo…)"
Quando o cliente responder: emita [SET_CARD_BRAND:resposta_exata] — aceite qualquer valor sem questionar.
PROIBIDO: validar, pedir outros dados.`;

  } else if (flowState === FLOW_STATES.COLLECTING_CHANGE) {
    stateBlock = `TAREFA: perguntar se precisa de troco.
Pergunta: "Precisa de troco? Se sim, para qual valor?"
Com troco: [SET_CHANGE:valor] (ex: [SET_CHANGE:R$50]) — sem troco: [SET_CHANGE:none]
Aceite qualquer resposta sem questionar. PROIBIDO pedir outros dados.`;

  } else if (flowState === FLOW_STATES.COLLECTING_CPF) {
    stateBlock = `DADOS JÁ COLETADOS — NÃO peça novamente:
Endereço: ${customerData.street||'?'}, ${customerData.number||'?'} — ${customerData.neighborhood||'?'}, ${customerData.city||'?'}/${customerData.state||'?'} — CEP ${customerData.zipCode||'?'}
Pagamento: ${customerData.paymentType||'?'} ← JÁ DEFINIDO, não pergunte pagamento de novo.

TAREFA: perguntar CPF para nota fiscal (OPCIONAL).
Pergunta: "Deseja CPF na nota fiscal? (informe os 11 dígitos ou diga 'não')"
Com CPF: [SET_CPF:somente_os_11_digitos] — sem CPF: [SET_CPF:none]
❌ PROIBIDO perguntar pagamento, endereço ou qualquer outro dado.
Se o cliente responder algo que não sejam dígitos (ex: "não", "n", "pular", "pix"): emita [SET_CPF:none]`;

  } else if (flowState === FLOW_STATES.COLLECTING_PAYMENT) {
    const resumo = cart.map(i => `${i.quantity}x${i.name}:R$${(i.price*i.quantity).toFixed(2)}`).join(',');
    stateBlock = `TAREFA: informar resumo e perguntar forma de pagamento.
Resumo: ${resumo} | Entrega:R$${deliveryPrice.toFixed(2)} | Total:R$${total.toFixed(2)} | End:${customerData.street||'?'},${customerData.number||'?'}-${customerData.neighborhood||'?'},${customerData.city||'?'}/${customerData.state||'?'},CEP:${customerData.zipCode||'?'}
Opções (use EXATAMENTE estas tags):
  Pix            → [SET_PAYMENT:Pix]
  Dinheiro       → [SET_PAYMENT:Dinheiro]
  Cartão Crédito → [SET_PAYMENT:Cartão Crédito]
  Cartão Débito  → [SET_PAYMENT:Cartão Débito]
Após cliente escolher: emita a tag correspondente. Sistema perguntará o próximo dado automaticamente.`;

  } else if (flowState === FLOW_STATES.CONFIRMING_ORDER) {
    const payInfo = (customerData.paymentType?.includes('Cartão'))
      ? `${customerData.paymentType}${customerData.cardBrand ? ` (${customerData.cardBrand})` : ''}`
      : customerData.paymentType === 'Dinheiro'
        ? `Dinheiro${customerData.changeAmount && customerData.changeAmount !== 'none' ? ` | Troco: ${customerData.changeAmount}` : ''}`
        : customerData.paymentType;

    const cartResumo = cart.map(i => `${i.quantity}x ${i.name} (R$${(i.price*i.quantity).toFixed(2)})`).join(', ');

    stateBlock = `CONFIRMANDO PEDIDO — apresente o resumo e AGUARDE a resposta do cliente:
Cliente: ${nomeCliente}
Endereço: ${customerData.street}, ${customerData.number} — ${customerData.neighborhood}, ${customerData.city}/${customerData.state} — CEP ${customerData.zipCode}
Pagamento: ${payInfo}${customerData.cpf && customerData.cpf !== 'none' ? ` | CPF: ${customerData.cpf}` : ''}
Carrinho: ${cartResumo}
Total: R$${total.toFixed(2)} (inclui entrega R$${deliveryPrice.toFixed(2)})

INSTRUÇÕES:
1. Apresente os dados acima de forma clara para o cliente conferir
2. Pergunte: "Confirma o pedido? (1 para confirmar / 2 para cancelar)"
3. ❌ NÃO emita [CONFIRM_ORDER] ou [CANCEL_CHECKOUT] nesta mensagem — AGUARDE a resposta
4. Quando o cliente responder 1/sim/confirmar → escreva texto curto + [CONFIRM_ORDER]
   ✅ Exemplo: "Ótimo! Pedido enviado! 🎉 [CONFIRM_ORDER]"
5. Quando o cliente responder 2/não/cancelar → escreva texto curto + [CANCEL_CHECKOUT]
   ✅ Exemplo: "Tudo bem, pedido cancelado. [CANCEL_CHECKOUT]"
6. ❌ NUNCA responda APENAS com a tag sem texto — sempre inclua ao menos uma frase.`;
  }

  return `Você é um atendente de supermercado com anos de experiência — conhece cada corredor, cada produto e sabe exatamente o que o cliente precisa antes mesmo de ele terminar a frase. Atende pelo chat do ${nomeSupermercado} com a mesma naturalidade e expertise de quem está atrás do balcão.

O nome do supermercado é "${nomeSupermercado}". Quando o cliente perguntar o nome do estabelecimento, responda com este nome.

Você conhece profundamente produtos de mercearia, hortifruti, carnes, frios, laticínios, bebidas, higiene, limpeza e tudo mais que um supermercado oferece. Usa esse conhecimento para:
• Entender exatamente o que o cliente pediu e mostrar apenas isso
• Ser direto e útil, sem enrolação — mostre o produto pedido, sem adicionar sugestões não solicitadas
• Quando o produto não estiver em estoque, informar claramente sem sugerir substitutos

Responda sempre de forma natural e humana. Sem formalidade excessiva, sem robotismo.

🚫 REGRA ABSOLUTA: NUNCA invente produtos, nomes, preços ou quantidades em estoque. Use SOMENTE o que está na lista PRODUTOS abaixo. Se o produto não estiver lá, diga que não temos no momento.

TAGS = comandos do sistema. Sem elas NADA acontece:
  [ADD:ID:QTD] → adiciona ao carrinho | [SHOW:ID] → exibe card | [REMOVE:ID] → remove
  [START_CHECKOUT] → inicia checkout | [CONFIRM_ORDER] → confirma pedido
  NUNCA confirme ação sem emitir a tag. NUNCA emita [CONFIRM_ORDER] sem endereço e pagamento coletados.

ESTADO ATUAL: ${flowState} — siga SOMENTE o que o estado pede. Não repita perguntas já feitas.
COLETA: nos estados COLLECTING_*, emita [SET_*:valor_exato] — aceite qualquer resposta sem questionar.
${cartLine}${secaoProdutos}${secaoExemplos}
${stateBlock}`;
}
