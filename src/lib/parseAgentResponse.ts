import {
  FLOW_STATES,
  FlowState,
  Produto,
  CartItem,
  CustomerData,
  EnderecoSalvo,
} from './buildSystemPrompt';

// ============================================================
// MAPA DE CAMPOS E ESTADOS
// ============================================================

/** Estado de coleta → campo do CustomerData */
export const COLLECTING_FIELD: Partial<Record<FlowState, keyof CustomerData>> = {
  [FLOW_STATES.COLLECTING_STREET]:       'street',
  [FLOW_STATES.COLLECTING_NUMBER]:       'number',
  [FLOW_STATES.COLLECTING_NEIGHBORHOOD]: 'neighborhood',
  [FLOW_STATES.COLLECTING_CITY]:         'city',
  [FLOW_STATES.COLLECTING_STATE]:        'state',
  [FLOW_STATES.COLLECTING_ZIPCODE]:      'zipCode',
  [FLOW_STATES.COLLECTING_PAYMENT]:      'paymentType',
  [FLOW_STATES.COLLECTING_CARD_BRAND]:   'cardBrand',
  [FLOW_STATES.COLLECTING_CHANGE]:       'changeAmount',
  [FLOW_STATES.COLLECTING_CPF]:          'cpf',
};

/** Próximo estado após cada coleta */
export const NEXT_STATE: Partial<Record<FlowState, FlowState>> = {
  [FLOW_STATES.COLLECTING_STREET]:       FLOW_STATES.COLLECTING_NUMBER,
  [FLOW_STATES.COLLECTING_NUMBER]:       FLOW_STATES.COLLECTING_NEIGHBORHOOD,
  [FLOW_STATES.COLLECTING_NEIGHBORHOOD]: FLOW_STATES.COLLECTING_CITY,
  [FLOW_STATES.COLLECTING_CITY]:         FLOW_STATES.COLLECTING_STATE,
  [FLOW_STATES.COLLECTING_STATE]:        FLOW_STATES.COLLECTING_ZIPCODE,
  [FLOW_STATES.COLLECTING_ZIPCODE]:      FLOW_STATES.ASKING_SAVE_ADDRESS,
  [FLOW_STATES.ASKING_SAVE_ADDRESS]:     FLOW_STATES.COLLECTING_PAYMENT,
  [FLOW_STATES.COLLECTING_PAYMENT]:      FLOW_STATES.COLLECTING_CPF,
  [FLOW_STATES.COLLECTING_CARD_BRAND]:   FLOW_STATES.COLLECTING_CPF,
  [FLOW_STATES.COLLECTING_CHANGE]:       FLOW_STATES.COLLECTING_CPF,
  [FLOW_STATES.COLLECTING_CPF]:          FLOW_STATES.CONFIRMING_ORDER,
};

/** Próximo estado após pagamento, dependendo do tipo escolhido */
export function nextStateAfterPayment(paymentType: string): FlowState {
  const t = paymentType.toLowerCase();
  if (t.includes('cart') || t.includes('card')) return FLOW_STATES.COLLECTING_CARD_BRAND;
  if (t.includes('dinheiro') || t.includes('cash'))  return FLOW_STATES.COLLECTING_CHANGE;
  return FLOW_STATES.COLLECTING_CPF; // Pix
}

// ============================================================
// RESULTADO DO PARSE
// ============================================================
export interface ParseResult {
  cleanText:           string;
  produtosParaMostrar: Produto[];
  newCart:             CartItem[];
  newFlowState:        FlowState;
  newCustomerData:     CustomerData;
  shouldCreateOrder:   boolean;
  shouldSaveAddress:   boolean;
  suggestions:         string[];
  collectedName:       string;
}

// ============================================================
// PARSE AGENT RESPONSE — função pura (sem efeitos colaterais)
// ============================================================
export function parseAgentResponse(
  response:            string,
  products:            Produto[],
  currentCart:         CartItem[],
  currentFlowState:    FlowState,
  currentCustomerData: CustomerData,
  enderecoSalvo:       EnderecoSalvo | null = null,
): ParseResult {
  let clean                    = response;
  const produtosParaMostrar: Produto[] = [];
  let cart                     = [...currentCart];
  let flowState                = currentFlowState;
  let customerData             = { ...currentCustomerData };
  let shouldCreateOrder        = false;
  let shouldSaveAddress        = false;
  let suggestions:    string[] = [];

  // [SHOW:id] — só exibe cards no estado BROWSING, ignora esgotados
  if (currentFlowState === FLOW_STATES.BROWSING) {
    for (const m of response.matchAll(/\[SHOW:([^\]]+)\]/g)) {
      const produto = products.find((p) => p.id === m[1]);
      if (produto && produto.stock !== 0 && !produtosParaMostrar.find((p) => p.id === produto.id)) {
        produtosParaMostrar.push(produto);
      }
    }
  }
  clean = clean.replace(/\[SHOW:[^\]]+\]/g, '').trim();

  // [ADD:id:qty]
  for (const addMatch of response.matchAll(/\[ADD:([^:\]]+):(\d+)\]/g)) {
    const [, productId, qty] = addMatch;
    const product = products.find((p) => p.id === productId);
    if (product) {
      if (!produtosParaMostrar.find((p) => p.id === productId)) {
        produtosParaMostrar.push(product);
      }
      const existing = cart.find((i) => i.id === productId);
      if (existing) {
        cart = cart.map((i) =>
          i.id === productId ? { ...i, quantity: i.quantity + parseInt(qty) } : i
        );
      } else {
        cart = [...cart, { ...product, quantity: parseInt(qty) }];
      }
    }
  }
  clean = clean.replace(/\[ADD:[^\]]+\]/g, '').trim();

  // [REMOVE:id]
  const removeMatch = response.match(/\[REMOVE:([^\]]+)\]/);
  if (removeMatch) {
    cart  = cart.filter((i) => i.id !== removeMatch[1]);
    clean = clean.replace(/\[REMOVE:[^\]]+\]/g, '').trim();
  }

  // [START_CHECKOUT]
  if (response.includes('[START_CHECKOUT]')) {
    if (currentFlowState === FLOW_STATES.BROWSING) {
      if (cart.length === 0) {
        clean = 'Seu carrinho está vazio! Adicione alguns produtos primeiro. 🛒';
      } else {
        if (enderecoSalvo) {
          flowState = FLOW_STATES.CHECKING_SAVED_ADDRESS;
          clean = `Ótimo, vamos finalizar! 🛒\n\nEncontrei um endereço salvo:\n📍 ${enderecoSalvo.street}, ${enderecoSalvo.number} — ${enderecoSalvo.neighborhood}, ${enderecoSalvo.city} (CEP ${enderecoSalvo.zipCode})\n\nDeseja usar este endereço ou informar um novo?`;
        } else {
          flowState = FLOW_STATES.COLLECTING_STREET;
          clean = 'Ótimo, vamos finalizar! 🛒\n\nQual é a rua/avenida de entrega?';
        }
      }
    } else {
      clean = clean.replace(/\[START_CHECKOUT\]/g, '').trim();
    }
  }

  // [USE_SAVED_ADDRESS]
  if (
    response.includes('[USE_SAVED_ADDRESS]') &&
    currentFlowState === FLOW_STATES.CHECKING_SAVED_ADDRESS &&
    enderecoSalvo
  ) {
    customerData = {
      ...customerData,
      street:       enderecoSalvo.street,
      number:       enderecoSalvo.number,
      neighborhood: enderecoSalvo.neighborhood,
      city:         enderecoSalvo.city,
      state:        enderecoSalvo.state,
      zipCode:      enderecoSalvo.zipCode,
    };
    flowState = FLOW_STATES.COLLECTING_PAYMENT;
    clean = clean.replace(/\[USE_SAVED_ADDRESS\]/g, '').trim();
  }

  // [NEW_ADDRESS]
  if (
    response.includes('[NEW_ADDRESS]') &&
    currentFlowState === FLOW_STATES.CHECKING_SAVED_ADDRESS
  ) {
    flowState = FLOW_STATES.COLLECTING_STREET;
    clean = clean.replace(/\[NEW_ADDRESS\]/g, '').trim();
  }

  // [SET_SAVE_ADDRESS:sim/nao]
  const saveAddressMatch = response.match(/\[SET_SAVE_ADDRESS:([^\]]*)\]/i);
  if (saveAddressMatch) {
    const val = saveAddressMatch[1].toLowerCase().trim();
    shouldSaveAddress = val === 'sim' || val === 'yes' || val === 's';
    flowState = FLOW_STATES.COLLECTING_PAYMENT;
    clean = clean.replace(/\[SET_SAVE_ADDRESS:[^\]]*\]/gi, '').trim();
  }

  // [SET_*:value]
  const fieldMap: Record<string, keyof CustomerData> = {
    STREET:       'street',
    NUMBER:       'number',
    NEIGHBORHOOD: 'neighborhood',
    CITY:         'city',
    STATE:        'state',
    ZIPCODE:      'zipCode',
    PAYMENT:      'paymentType',
    CARD_BRAND:   'cardBrand',
    CHANGE:       'changeAmount',
    CPF:          'cpf',
  };

  for (const m of response.matchAll(/\[SET_([A-Z_]+):([^\]]*)\]/g)) {
    const tagKey   = m[1];
    const tagValue = m[2] === 'none' ? '' : m[2];
    const field    = fieldMap[tagKey];
    if (field) {
      customerData = { ...customerData, [field]: tagValue };
      const stateEntry = Object.entries(COLLECTING_FIELD).find(([, f]) => f === field);
      if (stateEntry) {
        const stateKey = stateEntry[0] as FlowState;
        if (stateKey === FLOW_STATES.COLLECTING_PAYMENT) {
          flowState = nextStateAfterPayment(tagValue);
        } else {
          const next = NEXT_STATE[stateKey];
          if (next) flowState = next;
        }
      }
    }
    clean = clean.replace(m[0], '').trim();
  }

  // [SET_NAME:valor]
  let collectedName = '';
  const nameMatch = response.match(/\[SET_NAME:([^\]]+)\]/i);
  if (nameMatch) {
    collectedName = nameMatch[1].trim();
    flowState = FLOW_STATES.BROWSING;
    clean = clean.replace(/\[SET_NAME:[^\]]+\]/gi, '').trim();
  }

  // [CONFIRM_ORDER]
  if (
    response.includes('[CONFIRM_ORDER]') &&
    currentFlowState === FLOW_STATES.CONFIRMING_ORDER &&
    cart.length > 0
  ) {
    shouldCreateOrder = true;
    clean = clean.replace(/\[CONFIRM_ORDER\]/g, '').trim();
  } else {
    clean = clean.replace(/\[CONFIRM_ORDER\]/g, '').trim();
  }

  // [CANCEL_CHECKOUT]
  if (response.includes('[CANCEL_CHECKOUT]')) {
    flowState    = FLOW_STATES.BROWSING;
    customerData = {};
    clean        = clean.replace(/\[CANCEL_CHECKOUT\]/g, '').trim();
  }

  // [SUGGEST:termo1,termo2,...]
  const suggestMatch = response.match(/\[SUGGEST:([^\]]+)\]/);
  if (suggestMatch) {
    suggestions = suggestMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    clean = clean.replace(/\[SUGGEST:[^\]]+\]/g, '').trim();
  }

  return {
    cleanText:           clean.trim(),
    produtosParaMostrar,
    newCart:             cart,
    newFlowState:        flowState,
    newCustomerData:     customerData,
    shouldCreateOrder,
    shouldSaveAddress,
    suggestions,
    collectedName,
  };
}
