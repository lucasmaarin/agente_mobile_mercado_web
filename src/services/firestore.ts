/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  Timestamp,
  doc,
  increment,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Produto, CartItem, CustomerData, FlowState, EnderecoSalvo } from '@/lib/buildSystemPrompt';

export const DELIVERY_PRICE = 5.00;

const PAYMENT_LABELS: Record<string, string> = {
  'Dinheiro':        'PaymentType.cash',
  'Cartão Crédito':  'PaymentType.creditcard',
  'Cartão Débito':   'PaymentType.debitcard',
  'PIX':             'PaymentType.pix',
  'Pix':             'PaymentType.pix',
};

function gerarOrderNumber(): string {
  return String(Math.floor(Math.random() * 999999 + 1)).padStart(6, '0');
}

export async function buscarLogoEstabelecimento(companyId: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'estabelecimentos', companyId));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  return (data.imageUrl ?? data.logoUrl ?? data.logo ?? data.image ?? null) as string | null;
}

export async function buscarNomeEstabelecimento(companyId: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'estabelecimentos', companyId));
  if (!snap.exists()) {
    console.warn('[buscarNomeEstabelecimento] Documento não encontrado:', companyId);
    return null;
  }
  const data = snap.data() as Record<string, unknown>;
  const nome = (data.name ?? data.nome ?? data.displayName ?? null) as string | null;
  console.log('[buscarNomeEstabelecimento] companyId:', companyId, '| name:', nome, '| data:', data);
  return nome;
}

export const GUEST_USER_DOC_ID = 'guest_test';

export async function criarOuObterUsuarioConvidado(): Promise<string> {
  const ref = doc(db, 'Users', GUEST_USER_DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      userAuthId: 'guest',
      nomeCompleto: 'Convidado',
      createAt: Timestamp.now(),
      updateAt: Timestamp.now(),
    });
  }
  return GUEST_USER_DOC_ID;
}

export async function criarUsuarioNovo(uid: string, telefone?: string): Promise<string> {
  const now = Timestamp.now();
  const ref = await addDoc(collection(db, 'Users'), {
    userAuthId: uid,
    nomeCompleto: '',
    telefone: telefone ?? '',
    createAt: now,
    updateAt: now,
  });
  return ref.id;
}

export async function atualizarNomeUsuario(docId: string, nome: string): Promise<void> {
  await updateDoc(doc(db, 'Users', docId), {
    nomeCompleto: nome,
    updateAt: Timestamp.now(),
  });
}

export async function atualizarDadosUsuario(
  docId: string,
  dados: { nomeCompleto?: string; cpf?: string; telefone?: string }
): Promise<void> {
  await updateDoc(doc(db, 'Users', docId), {
    ...dados,
    updateAt: Timestamp.now(),
  });
}

export async function buscarFormasPagamento(companyId: string): Promise<string[]> {
  const snap = await getDoc(doc(db, 'estabelecimentos', companyId));
  if (!snap.exists()) return [];
  const data = snap.data() as Record<string, unknown>;
  const methods = data.paymentMethods as { name?: string }[] | undefined;
  if (!Array.isArray(methods)) return [];
  return methods.map((m) => m.name ?? '').filter(Boolean);
}

// ── CONFIG DA LOJA ──────────────────────────────────────────
export interface ConfigLoja {
  pedidoMinimo: number;
  taxaEntrega: number;
  distanciaMaxima: number;
  coordsEstabelecimento?: { lat: number; lng: number };
  horarios: { dia: string; aberto: boolean; abertura: string; fechamento: string }[];
}

const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

function extrairHoraDeValor(val: unknown): string {
  if (typeof val === 'string') return val.substring(0, 5);
  if (val && typeof val === 'object') {
    const v = val as Record<string, unknown>;
    if (typeof v.seconds === 'number') {
      const d = new Date(v.seconds * 1000);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
      const d = (v as { toDate: () => Date }).toDate();
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  return '08:00';
}

export async function buscarConfigLoja(companyId: string): Promise<ConfigLoja> {
  const defaultHorarios = DIAS_SEMANA.map(dia => ({ dia, aberto: true, abertura: '08:00', fechamento: '20:00' }));
  const defaultConfig: ConfigLoja = { pedidoMinimo: 60, taxaEntrega: 5, distanciaMaxima: 40, horarios: defaultHorarios };

  try {
    const snap = await getDoc(doc(db, 'estabelecimentos', companyId));
    if (!snap.exists()) return defaultConfig;

    const data = snap.data() as Record<string, unknown>;
    const delivery = (data.deliveryInfo ?? {}) as Record<string, unknown>;

    // Busca minimumPriceCart no estabelecimento (principal fonte)
    // Se não encontrar, tenta fixedValue (compatibilidade com versões antigas)
    const pedidoMinimo  = typeof data.minimumPriceCart === 'number' 
      ? data.minimumPriceCart 
      : typeof delivery.fixedValue === 'number' 
        ? delivery.fixedValue 
        : 60;
    const taxaEntrega   = typeof delivery.deliveryFee     === 'number' ? delivery.deliveryFee     : DELIVERY_PRICE;
    const distanciaMaxima = typeof delivery.maximunDistance === 'number' ? delivery.maximunDistance : 40;

    // Coordenadas do estabelecimento — suporta campos diretos ou objeto aninhado
    let coordsEstabelecimento: { lat: number; lng: number } | undefined;
    const lat = typeof delivery.latitude  === 'number' ? delivery.latitude  : typeof (delivery.location as Record<string,unknown>)?.latitude  === 'number' ? (delivery.location as Record<string,unknown>).latitude  as number : null;
    const lng = typeof delivery.longitude === 'number' ? delivery.longitude : typeof (delivery.location as Record<string,unknown>)?.longitude === 'number' ? (delivery.location as Record<string,unknown>).longitude as number : null;
    if (lat !== null && lng !== null) coordsEstabelecimento = { lat, lng };

    const rawHorarios = Array.isArray(data.openingHours) ? data.openingHours as Record<string, unknown>[] : [];
    const horarios = DIAS_SEMANA.map((dia, idx) => {
      const h = rawHorarios[idx];
      if (!h) return { dia, aberto: false, abertura: '08:00', fechamento: '20:00' };
      return {
        dia,
        aberto:    Boolean(h.isOpen),
        abertura:  extrairHoraDeValor(h.openingHours),
        fechamento: extrairHoraDeValor(h.closeHours),
      };
    });

    return { pedidoMinimo, taxaEntrega, distanciaMaxima, coordsEstabelecimento, horarios };
  } catch {
    return defaultConfig;
  }
}

export interface InfoEstabelecimento {
  aberto?: boolean;
  horarioFechamento?: string;
  tempoMin?: number;
  tempoMax?: number;
  taxaEntrega?: number;
  avaliacao?: number;
}

export async function buscarInfoEstabelecimento(companyId: string): Promise<InfoEstabelecimento> {
  try {
    const snap = await getDoc(doc(db, 'estabelecimentos', companyId));
    if (!snap.exists()) return {};

    const data = snap.data() as Record<string, unknown>;

    // Tempos de entrega (int64 do Firestore pode vir como número ou objeto)
    const tempoMinRaw = data.minimumDeliveryTimeInMinutes;
    const tempoMaxRaw = data.maximumDeliveryTimeInMinutes;
    const tempoMin = tempoMinRaw != null ? Number(tempoMinRaw) : undefined;
    const tempoMax = tempoMaxRaw != null ? Number(tempoMaxRaw) : undefined;

    // Taxa de entrega
    const delivery = (data.deliveryInfo ?? {}) as Record<string, unknown>;
    const taxaEntrega = typeof delivery.baseValue === 'number' ? delivery.baseValue : undefined;

    // Status de abertura hoje
    const rawHorarios = Array.isArray(data.openingHours) ? data.openingHours as Record<string, unknown>[] : [];
    // JS getDay(): 0=Dom, 1=Seg...6=Sab; Firestore weekday: 1=Seg...7=Dom
    const jsDay = new Date().getDay();
    const firestoreWeekday = jsDay === 0 ? 7 : jsDay;
    const todayEntry = rawHorarios.find(h => Number(h.weekday) === firestoreWeekday) ?? rawHorarios[firestoreWeekday - 1];

    let aberto: boolean | undefined;
    let horarioFechamento: string | undefined;

    if (todayEntry) {
      aberto = Boolean(todayEntry.isOpen);
      horarioFechamento = extrairHoraDeValor(todayEntry.closeHours);
    }

    return { aberto, horarioFechamento, tempoMin, tempoMax, taxaEntrega, avaliacao: 4.9 };
  } catch {
    return {};
  }
}

export async function getProducts(companyId: string): Promise<Produto[]> {
  const ref = collection(db, 'estabelecimentos', companyId, 'Products');
  const q = query(
    ref,
    where('isActive', '==', true),
    where('isTrashed', '==', false)
  );
  const snap = await getDocs(q);
  const isTestEstab = companyId === 'estabelecimento-teste';
  const toStringArray = (value: unknown): string[] => {
    const fromUnknown = (item: unknown): string[] => {
      if (item == null) return [];
      if (typeof item === 'string') return [item];
      if (typeof item === 'number' || typeof item === 'boolean') return [String(item)];
      if (Array.isArray(item)) {
        return item.flatMap(fromUnknown);
      }
      if (typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const candidatos = [
          obj.tag,
          obj.tags,
          obj.name,
          obj.label,
          obj.value,
          obj.title,
          obj.text,
        ];
        return candidatos.flatMap(fromUnknown);
      }
      return [];
    };

    if (Array.isArray(value)) {
      return value
        .flatMap(fromUnknown)
        .flatMap((v) => v.split(/[,\n;|]/))
        .map((v) => v.trim())
        .filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(/[,\n;|]/)
        .map((v) => v.trim())
        .filter(Boolean);
    }
    if (typeof value === 'object' && value !== null) {
      return fromUnknown(value)
        .flatMap((v) => v.split(/[,\n;|]/))
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  };

  return snap.docs
    .map((d) => {
      const data  = d.data() as any;
      const stock: number = data.quantityInStock !== undefined ? data.quantityInStock : -1;
      return {
        id:            d.id,
        name:          data.name        ?? '',
        description:   data.description ?? '',
        price:         data.currentPrice ?? data.agranelValue ?? 0,
        category:      data.shelves?.[0]?.categoryName          ?? 'Geral',
        categoryId:    data.shelves?.[0]?.productCategoryId     ?? '',
        subcategory:   data.shelves?.[0]?.subcategoryName       ?? '',
        subcategoryId: data.shelves?.[0]?.productSubcategoryId  ?? '',
        image:         data.images?.[0]?.fileUrl ?? null,
        unityType:     data.unityType    ?? 'unidade',
        barCode:       data.barCode      ?? '',
        searchIndex:   toStringArray(data.searchIndex),
        wordKeys:      toStringArray(data.wordKeys),
        tags:          toStringArray(data.tags),
        stock,
      };
    })
    .filter((p) => isTestEstab || p.stock !== 0);
}

export async function createOrder(
  companyId: string,
  customerData: CustomerData,
  cart: CartItem[],
  clientId: string,
  clienteNome: string = 'Cliente'
): Promise<{ id: string; orderNumber: string; total: number }> {
  const now        = Timestamp.now();
  const cartTotal  = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const total      = cartTotal + DELIVERY_PRICE;
  const orderNumber = gerarOrderNumber();

  const clientRef  = doc(db, `Users/${clientId}`);
  const companyRef = doc(db, `estabelecimentos/${companyId}`);

  let valueBack: number | null = null;
  if (customerData.changeAmount && customerData.changeAmount !== '') {
    const match = customerData.changeAmount.match(/[\d]+(?:[.,]\d+)?/);
    if (match) valueBack = parseFloat(match[0].replace(',', '.'));
  }

  const documentInNote = (customerData.cpf && customerData.cpf !== '') ? customerData.cpf : null;

  const productsCart = cart.map((item) => ({
    id:                    item.id,
    quantity:              item.quantity,
    observationIsPermited: false,
    observations:          null,
    clientRef,
    companyRef,
    productRef: doc(db, `estabelecimentos/${companyId}/Products/${item.id}`),
    product: {
      id:           item.id,
      name:         item.name,
      description:  item.description ?? '',
      price:        item.price,
      previewPrice: 0,
      unitType:     `ProductUnitType.${item.unityType ?? 'unidade'}`,
      unitQuantity: 1,
      images: item.image
        ? [{
            fileUrl:        item.image,
            fileName:       '',
            folderPath:     '',
            reference:      null,
            itsFromPlatform: true,
            quality:        100,
          }]
        : [],
      barCode: item.barCode ?? '',
    },
  }));

  const s  = customerData.street       ?? '';
  const n  = customerData.number       ?? '';
  const nb = customerData.neighborhood ?? '';
  const cy = customerData.city         ?? '';
  const zp = customerData.zipCode      ?? '';
  const address = {
    id:           '',
    street:       s,
    number:       n,
    complement:   '',
    neighborhood: nb,
    city:         cy,
    state:        customerData.state ?? '',
    uf:           customerData.uf    ?? '',
    zipCode:      zp,
    reference:    '',
    name:         `${s}, ${n}, ${nb}`,
    fullAddress:  `${s}, Nº ${n}, ${nb}, ${cy}, CEP ${zp}.`,
    createAt:     now,
    updateAt:     now,
  };

  const INTERVALO_MIN = 60;
  const deliveryDate  = new Date(now.toMillis() + INTERVALO_MIN * 60 * 1000);
  const deliveryTs    = Timestamp.fromDate(deliveryDate);
  const minDate = new Date(now.toMillis() + 30 * 60 * 1000);
  const maxDate = new Date(now.toMillis() + 90 * 60 * 1000);
  const scheduleId = `${minDate.toISOString().slice(0, 16).replace('T', ' ')} - ${maxDate.toISOString().slice(0, 16).replace('T', ' ')}`;

  const purchaseRequest = {
    id:               '',
    orderNumber,
    clientName:       customerData.name ?? clienteNome,
    clientId,
    clientReference:  clientRef,
    companyReference: companyRef,
    companyName:      '',
    companyAddress:   '',
    companyImageUrl:  '',
    address,
    productsCart,
    price:            cartTotal,
    deliveryPrice:    DELIVERY_PRICE,
    total,
    currentPurchaseStatus: 'PurchaseStatus.pending',
    statusList: [{ purchaseStatus: 'PurchaseStatus.pending', createdAt: now }],
    purchasePayment: {
      paymentType:  PAYMENT_LABELS[customerData.paymentType ?? ''] ?? 'PaymentType.cash',
      paymentValue: 0,
      valueBack,
    },
    scheduling:            deliveryTs,
    schedule: {
      id:                  scheduleId,
      minDateTime:         Timestamp.fromDate(minDate),
      maxDateTime:         Timestamp.fromDate(maxDate),
      value:               0,
      isAutomaticSchedule: true,
    },
    estimatedTimeDelivery: { date: deliveryTs, intervalMinutes: INTERVALO_MIN },
    deliveryPerson:        { name: '', email: '', phone: '' },
    cancelReason:          '',
    codeConfirmation:      '',
    documentInNote,
    review:                null,
    chatReference:         null,
    schedulerRef:          null,
    createdAt:             now,
    updatedAt:             null,
  };

  const ref = await addDoc(collection(db, 'PurchaseRequests'), purchaseRequest);
  await updateDoc(ref, { id: ref.id });
  return { id: ref.id, orderNumber, total };
}

const SHOPPING_CART_PATH = (companyId: string, userId: string) =>
  `Users/${userId}/ShoppingCart/${companyId}/Items`;

export async function sincronizarItemCarrinho(
  companyId: string,
  userId: string,
  item: CartItem
): Promise<void> {
  const now        = Timestamp.now();
  const clientRef  = doc(db, `Users/${userId}`);
  const companyRef = doc(db, `estabelecimentos/${companyId}`);
  const itemRef    = doc(db, SHOPPING_CART_PATH(companyId, userId), item.id);

  await setDoc(itemRef, {
    id:        item.id,
    quantity:  item.quantity,
    clientId:  userId,
    companyId: companyId,
    clientRef,
    companyRef,
    product: {
      barCode:      item.barCode      ?? '',
      description:  item.description  ?? '',
      currentPrice: item.price,
      images: item.image
        ? [{
            fileUrl:        item.image,
            fileName:       '',
            folderPath:     '',
            reference:      null,
            itsFromPlatform: true,
            quality:        100,
          }]
        : [],
    },
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
}

export async function removerItemCarrinhoFirestore(
  companyId: string,
  userId: string,
  productId: string
): Promise<void> {
  await deleteDoc(doc(db, SHOPPING_CART_PATH(companyId, userId), productId));
}

export async function limparCarrinhoFirestore(companyId: string, userId: string): Promise<void> {
  const snap = await getDocs(collection(db, SHOPPING_CART_PATH(companyId, userId)));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}

export async function buscarEnderecoDefault(userId: string): Promise<EnderecoSalvo | null> {
  const q = query(
    collection(db, 'Users', userId, 'Addresses'),
    where('savedByAgent', '==', true),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const data = snap.docs[0].data() as any;
  return {
    street:       data.street       ?? '',
    number:       data.number       ?? '',
    neighborhood: data.neighborhood ?? '',
    city:         data.city         ?? '',
    state:        data.state        ?? '',
    zipCode:      data.zipCode      ?? '',
  };
}

export async function salvarEnderecoDefault(
  userId: string,
  customerData: CustomerData
): Promise<void> {
  const now = Timestamp.now();
  const addressData = {
    street:       customerData.street       ?? '',
    number:       customerData.number       ?? '',
    complement:   '',
    neighborhood: customerData.neighborhood ?? '',
    city:         customerData.city         ?? '',
    state:        customerData.state        ?? '',
    uf:           customerData.uf           ?? '',
    zipCode:      customerData.zipCode      ?? '',
    reference:    '',
    savedByAgent: true,
    name:         `${customerData.street ?? ''}, ${customerData.number ?? ''}, ${customerData.neighborhood ?? ''}`,
    fullAddress:  `${customerData.street ?? ''}, Nº ${customerData.number ?? ''}, ${customerData.neighborhood ?? ''}, ${customerData.city ?? ''}/${customerData.state ?? ''}, CEP ${customerData.zipCode ?? ''}.`,
    createAt:     now,
    updateAt:     now,
  };

  const q = query(
    collection(db, 'Users', userId, 'Addresses'),
    where('savedByAgent', '==', true),
    limit(1)
  );
  const snap = await getDocs(q);

  if (!snap.empty) {
    await updateDoc(snap.docs[0].ref, { ...addressData, updateAt: now });
  } else {
    const ref = await addDoc(collection(db, 'Users', userId, 'Addresses'), addressData);
    await updateDoc(ref, { id: ref.id });
  }
}

// Estrutura:
//   AgenteVendas/{userId}                              ← dados do usuário (nome, createdAt)
//   AgenteVendas/{userId}/conversas/{conversaId}       ← dados da conversa
//   AgenteVendas/{userId}/conversas/{conversaId}/mensagens/{msgId}  ← mensagens
const USUARIO_DOC  = (userId: string) =>
  doc(db, 'AgenteVendas', userId);
const CONVERSAS_COL = (userId: string) =>
  collection(db, 'AgenteVendas', userId, 'conversas');
const CONVERSA_DOC  = (userId: string, conversaId: string) =>
  doc(db, 'AgenteVendas', userId, 'conversas', conversaId);
const MENSAGENS_COL = (userId: string, conversaId: string) =>
  collection(db, 'AgenteVendas', userId, 'conversas', conversaId, 'mensagens');

export type StatusConversa =
  | 'ativa'
  | 'pedido_realizado'
  | 'abandonada'
  | 'cancelada';

export interface DadosConversa {
  conversaId:              string;
  userId:                  string;
  clienteNome:             string;
  startedAt:               Timestamp;
  updatedAt:               Timestamp;
  endedAt:                 Timestamp | null;
  flowStateAtual:          FlowState;
  totalMensagens:          number;
  totalMensagensUsuario:   number;
  totalMensagensAgente:    number;
  pedidoGerado:            boolean;
  pedidoId:                string | null;
  pedidoOrderNumber:       string | null;
  pedidoTotal:             number | null;
  carrinhoFinal:           CartItem[];
  customerDataColetado:    CustomerData;
  status:                  StatusConversa;
  origem:                  'agente_ia';
}

export interface DadosMensagem {
  mensagemId:        string;
  conversaId:        string;
  userId:            string;
  role:              'user' | 'assistant';
  content:           string;
  timestamp:         Timestamp;
  flowStateAntes:    FlowState;
  flowStateDepois:   FlowState;
  tagsDetectadas:    string[];
  produtosCardIds:   string[];
  tokensUsados:      number | null;
}

export async function criarConversa(
  userId:      string,
  clienteNome: string,
  flowState:   FlowState
): Promise<string> {
  // Garante que o documento do usuário existe com dados básicos
  await setDoc(USUARIO_DOC(userId), {
    userId,
    nome:      clienteNome,
    updatedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
  }, { merge: true });

  const now = Timestamp.now();
  const ref = await addDoc(
    CONVERSAS_COL(userId),
    {
      conversaId:            '',
      userId,
      clienteNome,
      startedAt:             now,
      updatedAt:             now,
      endedAt:               null,
      flowStateAtual:        flowState,
      totalMensagens:        0,
      totalMensagensUsuario: 0,
      totalMensagensAgente:  0,
      pedidoGerado:          false,
      pedidoId:              null,
      pedidoOrderNumber:     null,
      pedidoTotal:           null,
      carrinhoFinal:         [],
      customerDataColetado:  {},
      status:                'ativa' as StatusConversa,
      origem:                'agente_ia',
    } satisfies Omit<DadosConversa, 'conversaId'> & { conversaId: '' }
  );

  await updateDoc(ref, { conversaId: ref.id });
  return ref.id;
}

export async function salvarMensagem(
  conversaId:     string,
  userId:         string,
  role:           'user' | 'assistant',
  content:        string,
  flowStateAntes: FlowState,
  flowStateDepois: FlowState,
  tagsDetectadas: string[],
  produtosCardIds: string[],
  tokensUsados:   number | null = null
): Promise<void> {
  const now = Timestamp.now();

  const msgRef = await addDoc(
    MENSAGENS_COL(userId, conversaId),
    {
      mensagemId:      '',
      conversaId,
      userId,
      role,
      content,
      timestamp:       now,
      flowStateAntes,
      flowStateDepois,
      tagsDetectadas,
      produtosCardIds,
      tokensUsados,
    } satisfies Omit<DadosMensagem, 'mensagemId'> & { mensagemId: '' }
  );
  await updateDoc(msgRef, { mensagemId: msgRef.id });

  await updateDoc(
    CONVERSA_DOC(userId, conversaId),
    {
      updatedAt:               now,
      flowStateAtual:          flowStateDepois,
      totalMensagens:          increment(1),
      totalMensagensUsuario:   role === 'user'      ? increment(1) : increment(0),
      totalMensagensAgente:    role === 'assistant' ? increment(1) : increment(0),
    }
  );
}

export async function atualizarConversa(
  userId: string,
  conversaId: string,
  dados: Partial<Pick<
    DadosConversa,
    | 'flowStateAtual'
    | 'carrinhoFinal'
    | 'customerDataColetado'
    | 'status'
    | 'pedidoGerado'
    | 'pedidoId'
    | 'pedidoOrderNumber'
    | 'pedidoTotal'
    | 'endedAt'
  >>
): Promise<void> {
  await updateDoc(
    CONVERSA_DOC(userId, conversaId),
    { ...dados, updatedAt: Timestamp.now() }
  );
}

export async function buscarConversaAtiva(
  userId: string
): Promise<DadosConversa | null> {
  const q = query(
    CONVERSAS_COL(userId),
    orderBy('startedAt', 'desc'),
    limit(20)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const ativa = snap.docs.find((d) => (d.data() as DadosConversa).status === 'ativa');
  return ativa ? (ativa.data() as DadosConversa) : null;
}

export async function buscarMensagens(
  userId: string,
  conversaId: string
): Promise<DadosMensagem[]> {
  const q = query(
    MENSAGENS_COL(userId, conversaId),
    orderBy('timestamp', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as DadosMensagem);
}

export interface MensagemExemplo {
  role: 'user' | 'assistant';
  content: string;
  produtoId?: string;
}

export interface ExemploConversa {
  exemploId: string;
  nome: string;
  criadoPor: string;
  criadoEm: Timestamp;
  ativo: boolean;
  mensagens: MensagemExemplo[];
}

const EXEMPLOS_COL = () =>
  collection(db, 'Agentes', 'AgenteVendas', 'ExemplosConversa');

export async function salvarExemplo(
  dados: Omit<ExemploConversa, 'exemploId'>
): Promise<string> {
  const ref = await addDoc(EXEMPLOS_COL(), { ...dados, exemploId: '' });
  await updateDoc(ref, { exemploId: ref.id });
  return ref.id;
}

export async function listarExemplos(): Promise<ExemploConversa[]> {
  const q = query(EXEMPLOS_COL(), orderBy('criadoEm', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ExemploConversa);
}

export async function atualizarExemplo(
  exemploId: string,
  dados: Partial<Pick<ExemploConversa, 'nome' | 'ativo' | 'mensagens'>>
): Promise<void> {
  await updateDoc(doc(db, 'Agentes', 'AgenteVendas', 'ExemplosConversa', exemploId), dados);
}

export async function deletarExemplo(exemploId: string): Promise<void> {
  await deleteDoc(doc(db, 'Agentes', 'AgenteVendas', 'ExemplosConversa', exemploId));
}

export async function carregarExemplosAtivos(): Promise<ExemploConversa[]> {
  const q = query(EXEMPLOS_COL(), where('ativo', '==', true));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ExemploConversa);
}

// ─── Pedidos (PurchaseRequests) ───────────────────────────────────────────────

export interface Pedido {
  id: string;
  orderNumber: string;
  clientName: string;
  clientId: string;
  total: number;
  currentPurchaseStatus: string;
  createdAt: Timestamp;
  address: {
    fullAddress: string;
    street: string;
    number: string;
    neighborhood: string;
    city: string;
  };
  productsCart: Array<{ product: { name: string }; quantity: number }>;
  estimatedTimeDelivery?: { intervalMinutes: number };
}

export async function buscarPedidosPorEstabelecimento(
  companyId: string,
  limite = 50
): Promise<Pedido[]> {
  const companyRef = doc(db, `estabelecimentos/${companyId}`);
  const q = query(
    collection(db, 'PurchaseRequests'),
    where('companyReference', '==', companyRef),
    orderBy('createdAt', 'desc'),
    limit(limite)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Pedido);
}

export async function buscarPedidosDoUsuario(
  companyId: string,
  clientId: string,
  limite = 50
): Promise<Pedido[]> {
  const companyRef = doc(db, `estabelecimentos/${companyId}`);
  const q = query(
    collection(db, 'PurchaseRequests'),
    where('companyReference', '==', companyRef),
    where('clientId', '==', clientId),
    orderBy('createdAt', 'desc'),
    limit(limite)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Pedido));
}

export async function atualizarStatusPedido(
  pedidoId: string,
  status: string
): Promise<void> {
  const ref = doc(db, 'PurchaseRequests', pedidoId);
  const snap = await getDoc(ref);
  const statusListAtual: unknown[] = snap.data()?.statusList ?? [];
  await updateDoc(ref, {
    currentPurchaseStatus: status,
    updatedAt: Timestamp.now(),
    statusList: [...statusListAtual, { purchaseStatus: status, createdAt: Timestamp.now() }],
  });
}

// ─── Push Subscriptions ───────────────────────────────────────────────────────

export async function buscarPushSubscription(
  clientId: string
): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } } | null> {
  const snap = await getDoc(doc(db, 'Users', clientId, 'pushSubscription', 'default'));
  if (!snap.exists()) return null;
  return snap.data() as { endpoint: string; keys: { p256dh: string; auth: string } };
}
