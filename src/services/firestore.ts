/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  query,
  where,
  getDocs,
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

const COMPANY_ID = 'estabelecimento-teste';
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

export async function getProducts(): Promise<Produto[]> {
  const ref = collection(db, 'estabelecimentos', COMPANY_ID, 'Products');
  const q = query(
    ref,
    where('isActive', '==', true),
    where('isTrashed', '==', false)
  );
  const snap = await getDocs(q);

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
        unityType:     data.unityType ?? 'unidade',
        barCode:       data.barCode   ?? '',
        stock,
      };
    })
    .filter((p) => p.stock !== 0);
}

export async function createOrder(
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
  const companyRef = doc(db, `estabelecimentos/${COMPANY_ID}`);

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
    productRef: doc(db, `estabelecimentos/${COMPANY_ID}/Products/${item.id}`),
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

const SHOPPING_CART_PATH = (userId: string) =>
  `Users/${userId}/ShoppingCart/${COMPANY_ID}/Items`;

export async function sincronizarItemCarrinho(
  userId: string,
  item: CartItem
): Promise<void> {
  const now        = Timestamp.now();
  const clientRef  = doc(db, `Users/${userId}`);
  const companyRef = doc(db, `estabelecimentos/${COMPANY_ID}`);
  const itemRef    = doc(db, SHOPPING_CART_PATH(userId), item.id);

  await setDoc(itemRef, {
    id:        item.id,
    quantity:  item.quantity,
    clientId:  userId,
    companyId: COMPANY_ID,
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

  await updateDoc(itemRef, { updatedAt: now, quantity: item.quantity });
}

export async function removerItemCarrinhoFirestore(
  userId: string,
  productId: string
): Promise<void> {
  await deleteDoc(doc(db, SHOPPING_CART_PATH(userId), productId));
}

export async function limparCarrinhoFirestore(userId: string): Promise<void> {
  const snap = await getDocs(collection(db, SHOPPING_CART_PATH(userId)));
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

const AGENTE_DOC = doc(db, 'Agentes', 'AgenteVendas');
const AGENTE_VENDAS_USER_DOC = (userId: string) => doc(db, 'agenteVendas', userId);
const CONVERSAS_COL = (userId: string) => collection(db, 'agenteVendas', userId, 'conversas');
const CONVERSA_DOC = (userId: string, conversaId: string) => doc(db, 'agenteVendas', userId, 'conversas', conversaId);
const MENSAGENS_COL = (userId: string, conversaId: string) => collection(db, 'agenteVendas', userId, 'conversas', conversaId, 'mensagens');

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

async function garantirDocAgente() {
  await setDoc(AGENTE_DOC, {
    nome:       'AgenteVendas',
    descricao:  'Agente de vendas IA — Mobile Mercado',
    criadoEm:   Timestamp.now(),
  }, { merge: true });
}

export async function criarConversa(
  userId:      string,
  clienteNome: string,
  flowState:   FlowState
): Promise<string> {
  await garantirDocAgente();
  await setDoc(AGENTE_VENDAS_USER_DOC(userId), {
    userId,
    updatedAt: Timestamp.now(),
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
  await garantirDocAgente();
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
