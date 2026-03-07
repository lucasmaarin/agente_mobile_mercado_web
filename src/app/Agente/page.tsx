/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useState, useEffect, useRef } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, query, where, getDocs } from "firebase/firestore";
import { Send, UserCircle, Loader2, ShoppingCart, X, ZoomIn, QrCode, Banknote, CreditCard, Plus, Minus } from "lucide-react";
import Image from "next/image";
import styles from "./Agente.module.css";
import { auth, db } from "@/lib/firebase";
import Header from "@/components/Header/Header";

import OpenAI from "openai";
import {
  FLOW_STATES,
  FlowState,
  Produto,
  CartItem,
  CustomerData,
  EnderecoSalvo,
  FewShotExemplo,
  buildSystemPrompt,
} from "@/lib/buildSystemPrompt";
import { parseAgentResponse, COLLECTING_FIELD, NEXT_STATE, nextStateAfterPayment } from "@/lib/parseAgentResponse";
import {
  getProducts,
  createOrder,
  criarConversa,
  salvarMensagem,
  atualizarConversa,
  buscarConversaAtiva,
  carregarExemplosAtivos,
  buscarEnderecoDefault,
  salvarEnderecoDefault,
  sincronizarItemCarrinho,
  removerItemCarrinhoFirestore,
  limparCarrinhoFirestore,
  ExemploConversa,
  DELIVERY_PRICE,
} from "@/services/firestore";
import { Timestamp } from "firebase/firestore";

// ============================================================
// UTILITÁRIOS DE FILTRAGEM DE PRODUTOS
// ============================================================

/** Remove acentos e converte para minúsculas para comparação */
function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const STOPWORDS_BUSCA = new Set([
  'oi', 'ola',
  'tem', 'tenho', 'quero', 'queria', 'preciso', 'procuro', 'busco',
  'me', 'pra', 'para', 'com', 'sem', 'uma', 'uns', 'umas', 'dos', 'das',
  'por', 'favor', 'pode', 'poderia', 'gostaria', 'de', 'do', 'da', 'em', 'tal', 'coisa'
]);

const ALIASES_BUSCA: Record<string, string[]> = {
  caixinha: ['caixa', 'integral', 'uht', '1lt', '1l', 'litro', 'lt'],
  caixa:    ['caixinha', 'integral', 'uht', '1lt', '1l', 'litro', 'lt'],
  po:       ['po', 'instantaneo', 'instantanea'],
  peito:    ['peito', 'file'],
  file:     ['file', 'peito'],
};

function variantesToken(token: string): string[] {
  const t = normalizar(token);
  const vars = new Set<string>([t]);
  if (t.length > 4 && t.endsWith('es')) vars.add(t.slice(0, -2));
  if (t.length > 3 && t.endsWith('s')) vars.add(t.slice(0, -1));
  return Array.from(vars);
}

function extrairPalavrasBaseBusca(texto: string): string[] {
  return normalizar(texto)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOPWORDS_BUSCA.has(w));
}

function ehSaudacaoCurta(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, ' ');
  return new Set([
    'oi',
    'ola',
    'bom dia',
    'boa tarde',
    'boa noite',
    'e ai',
    'tudo bem',
    'blz',
  ]).has(t);
}

function ehIntencaoCheckout(texto: string): boolean {
  const t = normalizar(texto);
  return (
    t.includes("finalizar") ||
    t.includes("fechar pedido") ||
    t.includes("finaliza pedido") ||
    t.includes("finalizar pedido") ||
    t.includes("pagar") ||
    t.includes("checkout")
  );
}

function ehAcaoContinuarComprando(texto: string): boolean {
  const t = normalizar(texto).replace(/[.!?]/g, "").trim();
  return (
    t === "continuar" ||
    t.includes("continuar compr") ||
    t.includes("seguir compr") ||
    t.includes("mais produtos") ||
    t.includes("continuar compra") ||
    t.includes("pode continuar")
  );
}

function ehAcaoAlterarItem(texto: string): boolean {
  const t = normalizar(texto).replace(/[.!?]/g, "").trim();
  return (
    t === "alterar" ||
    t.includes("alterar") ||
    t.includes("trocar") ||
    t.includes("substituir") ||
    t.includes("mudar item")
  );
}

function expandirPalavrasBusca(palavrasBase: string[]): string[] {
  const expandidas = new Set<string>();
  for (const palavra of palavrasBase) {
    for (const variante of variantesToken(palavra)) {
      expandidas.add(variante);
      for (const alias of ALIASES_BUSCA[variante] ?? []) {
        expandidas.add(normalizar(alias));
      }
    }
  }
  return Array.from(expandidas).filter((w) => w.length >= 2);
}

/**
 * Constrói o índice compacto de categorias → subcategorias (gerado 1x).
 * Formato: "- Mercearia: Maionese, Feijão, Arroz\n- Bebidas: ..."
 */
function buildIndiceCategoria(produtos: Produto[]): string {
  const mapa = new Map<string, { nome: string; subcats: Set<string> }>();
  for (const p of produtos) {
    const chave = p.categoryId || p.category;
    if (!mapa.has(chave)) mapa.set(chave, { nome: p.category, subcats: new Set() });
    if (p.subcategory) mapa.get(chave)!.subcats.add(p.subcategory);
  }
  // Formato compacto: "Mercearia(Maionese,Feijão,Arroz) | Bebidas(Suco,Refrigerante)"
  return Array.from(mapa.values())
    .map(({ nome, subcats }) => `${nome}(${Array.from(subcats).join(',')})`)
    .join(' | ');
}

/**
 * Filtra produtos relevantes para a mensagem do usuário com scoring de relevância.
 * Garante que pelo menos os top-3 de cada palavra-chave entrem no resultado,
 * permitindo atender pedidos com múltiplos itens de uma vez (ex: "macarrão, ovos, toddy").
 * Limite global de 20 produtos para não estourar o prompt.
 */
function filtrarProdutos(texto: string, produtos: Produto[]): Produto[] {
  const palavrasBase = extrairPalavrasBaseBusca(texto);

  if (palavrasBase.length === 0) return [];

  const palavras = expandirPalavrasBusca(palavrasBase);
  const fraseBase = palavrasBase.join(' ');

  const comScore = produtos.map((p) => {
    const nomeN   = normalizar(p.name);
    const subcatN = normalizar(p.subcategory);
    const catN    = normalizar(p.category);
    const descN   = normalizar(p.description || '');
    const alvo    = `${nomeN} ${subcatN} ${catN} ${descN}`;

    let score = 0;

    if (fraseBase.length >= 5) {
      if (nomeN.includes(fraseBase)) score += 45;
      else if (subcatN.includes(fraseBase)) score += 30;
      else if (alvo.includes(fraseBase)) score += 18;
    }

    const todosBasePresentes = palavrasBase.every((w) => alvo.includes(w));
    if (todosBasePresentes) score += 20;

    for (const w of palavras) {
      if (subcatN === w)            score += 12;
      else if (subcatN.includes(w)) score += 8;
      else if (nomeN.includes(w))   score += 6;
      else if (catN === w)          score += 5;
      else if (catN.includes(w))    score += 3;
      else if (descN.includes(w))   score += 2;
    }

    const temLeite = palavrasBase.includes('leite');
    const temCaixinha = palavrasBase.includes('caixinha') || palavrasBase.includes('caixa');
    if (temLeite && temCaixinha) {
      const pareceLeiteCaixinha =
        nomeN.includes('leite') &&
        (nomeN.includes('integral') || nomeN.includes('uht') || nomeN.includes('1lt') || nomeN.includes('1l') || nomeN.includes('litro') || nomeN.includes(' lt'));
      if (pareceLeiteCaixinha) score += 22;
    }

    if (temLeite && palavrasBase.includes('po')) {
      const pareceLeitePo =
        nomeN.includes('leite') &&
        (nomeN.includes('po') || nomeN.includes('instantaneo'));
      if (pareceLeitePo) score += 22;
    }

    if (palavrasBase.includes('frango') && palavrasBase.includes('peito')) {
      if (nomeN.includes('frango') && (nomeN.includes('peito') || nomeN.includes('file'))) {
        score += 24;
      }
    }

    if (palavrasBase.includes('frango') && palavrasBase.includes('inteiro')) {
      if (nomeN.includes('frango') && nomeN.includes('inteiro')) {
        score += 24;
      }
    }

    return { produto: p, score };
  }).filter(({ score }) => score > 0);

  const garantidos = new Set<string>();
  for (const w of palavrasBase) {
    comScore
      .filter(({ produto: p }) => {
        const nomeN = normalizar(p.name);
        const subcatN = normalizar(p.subcategory);
        const catN = normalizar(p.category);
        return nomeN.includes(w) || subcatN.includes(w) || catN.includes(w);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .forEach(({ produto: p }) => garantidos.add(p.id));
  }

  const ordenados = comScore.sort((a, b) => b.score - a.score);
  const resultado: Produto[] = [];

  for (const { produto } of ordenados) {
    if (garantidos.has(produto.id)) resultado.push(produto);
  }
  for (const { produto } of ordenados) {
    if (!garantidos.has(produto.id)) resultado.push(produto);
  }

  return resultado.slice(0, 20);
}

function selecionarCardsPorTermos(
  termos: string[],
  candidatos: Produto[],
  limite: number
): Produto[] {
  const selecionados: Produto[] = [];
  const ids = new Set<string>();
  const termosUnicos = Array.from(new Set(termos));

  const combinaTermo = (p: Produto, termo: string) => {
    const nome = normalizar(p.name);
    const sub = normalizar(p.subcategory);
    const cat = normalizar(p.category);
    const desc = normalizar(p.description || '');
    return nome.includes(termo) || sub.includes(termo) || cat.includes(termo) || desc.includes(termo);
  };

  for (const termo of termosUnicos) {
    const encontrado = candidatos.find((p) => !ids.has(p.id) && combinaTermo(p, termo));
    if (!encontrado) continue;
    ids.add(encontrado.id);
    selecionados.push(encontrado);
    if (selecionados.length >= limite) return selecionados;
  }

  for (const p of candidatos) {
    if (selecionados.length >= limite) break;
    if (ids.has(p.id)) continue;
    ids.add(p.id);
    selecionados.push(p);
  }

  return selecionados;
}

function combinarProdutosFoco(
  prioritarios: Produto[],
  catalogo: Produto[],
  limite: number = 20
): Produto[] {
  const resultado: Produto[] = [];
  const ids = new Set<string>();

  const push = (p: Produto) => {
    if (resultado.length >= limite) return;
    if (ids.has(p.id)) return;
    ids.add(p.id);
    resultado.push(p);
  };

  prioritarios.forEach(push);
  if (resultado.length >= limite) return resultado;

  const categoriasPrioritarias = new Set(
    prioritarios.map((p) => p.categoryId || p.category)
  );
  const categoriaJaInserida = new Set<string>();

  // Passo 1: adiciona diversidade (1 por categoria fora das prioritárias)
  for (const p of catalogo) {
    if (resultado.length >= limite) break;
    if (ids.has(p.id)) continue;
    const cat = p.categoryId || p.category;
    if (categoriasPrioritarias.has(cat)) continue;
    if (categoriaJaInserida.has(cat)) continue;
    categoriaJaInserida.add(cat);
    push(p);
  }

  // Passo 2: completa com qualquer item restante, mantendo ordem do catálogo
  for (const p of catalogo) {
    if (resultado.length >= limite) break;
    push(p);
  }

  return resultado;
}

// ============================================================
// FLUXO LOCAL: LISTA COM QUANTIDADES
// ============================================================
type ListaFlowStage =
  | "await_confirm"
  | "await_mode"
  | "selecting_variant"
  | "await_next_item";

interface ListaPedidoItem {
  termoOriginal: string;
  termoBusca: string;
  quantidade: number;
  candidatos: Produto[];
  selecionadoId?: string;
  cancelado?: boolean;
}

interface ListaPedidoState {
  stage: ListaFlowStage;
  itens: ListaPedidoItem[];
  currentIndex: number;
}

interface ItemUnicoQuantidadeState {
  termoBusca: string;
  quantidade: number;
  stage: "confirm_single" | "choose_other";
  candidatos: Produto[];
  produtoSugerido?: Produto;
}

function montarNomeCompletoUsuario(data: any, currentUser: User): string {
  const nomeDireto =
    data?.nomeCompleto ||
    data?.fullName ||
    data?.name ||
    data?.nome ||
    currentUser.displayName ||
    "";

  const nomeDiretoLimpo = String(nomeDireto).trim();
  if (nomeDiretoLimpo.includes(" ")) return nomeDiretoLimpo;

  const sobrenome = String(
    data?.sobrenome ||
    data?.lastName ||
    data?.surname ||
    ""
  ).trim();

  if (nomeDiretoLimpo && sobrenome) return `${nomeDiretoLimpo} ${sobrenome}`.trim();
  return nomeDiretoLimpo || "Cliente";
}

const NUMERO_POR_TEXTO: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  "três": 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

function numeroDaString(valor: string): number | null {
  const limpo = normalizar(valor.trim());
  if (/^\d+$/.test(limpo)) return parseInt(limpo, 10);
  return NUMERO_POR_TEXTO[limpo] ?? null;
}

function limparTermoItemLista(termo: string): string {
  return termo
    .replace(/\b(de|da|do|das|dos|com|sem|para|pra)\b/gi, " ")
    .replace(/\b(caixa|caixas|pacote|pacotes|sacola|sacolas|unidade|unidades|lata|latas|garrafa|garrafas)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairItensListaComQuantidade(texto: string): Array<{ termoOriginal: string; termoBusca: string; quantidade: number }> {
  const itens: Array<{ termoOriginal: string; termoBusca: string; quantidade: number }> = [];
  const pattern =
    /\b(\d+|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\b\s+([^,]+?)(?=(?:,|\be\b\s*(?:\d+|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\b|$))/gi;

  for (const match of texto.matchAll(pattern)) {
    const qtd = numeroDaString(match[1] || "");
    if (!qtd || qtd <= 0) continue;
    const termoOriginal = (match[2] || "").trim();
    if (!termoOriginal) continue;
    const termoBusca = limparTermoItemLista(termoOriginal);
    if (!termoBusca) continue;
    itens.push({ termoOriginal, termoBusca, quantidade: qtd });
  }

  return itens;
}

function limparMarkdownBasico(texto: string): string {
  return texto
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .trim();
}

function resumirTextoQuandoHaCards(texto: string, temCards: boolean): string {
  if (!temCards) return texto.trim();

  const linhas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const filtradas = linhas.filter((linha) => {
    if (/^\d+\.\s+/.test(linha)) return false;
    if (/^-\s+/.test(linha) && /R\$\s*\d/.test(linha)) return false;
    if (/R\$\s*\d/.test(linha) && linha.length <= 90) return false;
    return true;
  });

  const resultado = filtradas.join("\n").trim();
  return resultado || "Encontrei estas opcoes para voce. Qual voce prefere?";
}

function buscarAlternativasPorTermo(termo: string, catalogo: Produto[], excluirId?: string): Produto[] {
  const palavras = extrairPalavrasBaseBusca(termo);
  const termos = palavras.length > 0 ? palavras : [normalizar(termo)];
  return catalogo
    .filter((p) => {
      if (excluirId && p.id === excluirId) return false;
      const alvo = normalizar(`${p.name} ${p.subcategory} ${p.category} ${p.description || ""}`);
      return termos.some((t) => t.length >= 2 && alvo.includes(t));
    })
    .slice(0, 6);
}

function ehConfirmacaoPositiva(texto: string): boolean {
  const t = normalizar(texto).replace(/[.!?]/g, "").trim();
  return (
    ["sim", "s", "ok", "pode", "confirmar", "confirmo", "certo", "isso", "1"].includes(t) ||
    t.startsWith("confirmar")
  );
}

function ehCancelamento(texto: string): boolean {
  const t = normalizar(texto).replace(/[.!?]/g, "").trim();
  return ["cancelar", "cancelo", "cancela", "nao", "não", "2", "parar", "sair"].includes(t);
}

function ehEscolhaAutomatica(texto: string): boolean {
  const t = normalizar(texto);
  return t.includes("popular") || t.includes("automatic") || t.includes("autom") || t.includes("preench");
}

function ehEscolhaVariacao(texto: string): boolean {
  const t = normalizar(texto);
  return t.includes("variedad") || t.includes("escolher") || t.includes("selecion") || t.includes("opcao") || t.includes("opção");
}

function encontrarIndiceEscolhido(texto: string, limite: number): number | null {
  const t = normalizar(texto);
  const m = t.match(/\b(\d+)\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= limite) return n - 1;
  return null;
}

function formatarResumoCarrinho(cart: CartItem[]): string {
  if (cart.length === 0) return "Carrinho vazio.";
  return cart
    .map((i) => `${i.quantity}x ${i.name} - R$ ${(i.price * i.quantity).toFixed(2)}`)
    .join("\n");
}

function adicionarItemAoCarrinhoFn(cartAtual: CartItem[], produto: Produto, quantidade: number): CartItem[] {
  const existente = cartAtual.find((i) => i.id === produto.id);
  if (existente) {
    return cartAtual.map((i) =>
      i.id === produto.id ? { ...i, quantity: i.quantity + quantidade } : i
    );
  }
  return [...cartAtual, { ...produto, quantity: quantidade }];
}

function proximoIndicePendenteFn(itens: ListaPedidoItem[], atual: number): number {
  for (let i = atual + 1; i < itens.length; i++) {
    if (!itens[i].selecionadoId && !itens[i].cancelado) return i;
  }
  return -1;
}

// ============================================================
// TIPOS
// ============================================================
interface Mensagem {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  produtosCard?: Produto[]; // cards de produto exibidos junto à mensagem
  suggestions?: string[];   // chips clicáveis gerados pelo [SUGGEST:...] do agente
}

// Sequência para calcular progresso da barra
const CHECKOUT_SEQUENCE: FlowState[] = [
  FLOW_STATES.CHECKING_SAVED_ADDRESS,
  FLOW_STATES.COLLECTING_STREET,
  FLOW_STATES.COLLECTING_NUMBER,
  FLOW_STATES.COLLECTING_NEIGHBORHOOD,
  FLOW_STATES.COLLECTING_CITY,
  FLOW_STATES.COLLECTING_STATE,
  FLOW_STATES.COLLECTING_ZIPCODE,
  FLOW_STATES.ASKING_SAVE_ADDRESS,
  FLOW_STATES.COLLECTING_PAYMENT,
  FLOW_STATES.COLLECTING_CARD_BRAND,
  FLOW_STATES.COLLECTING_CHANGE,
  FLOW_STATES.COLLECTING_CPF,
  FLOW_STATES.CONFIRMING_ORDER,
];

const ESTADO_LABEL: Record<FlowState, string> = {
  browsing:                 "Navegando",
  checking_saved_address:   "Endereço",
  collecting_street:        "Rua",
  collecting_number:        "Número",
  collecting_neighborhood:  "Bairro",
  collecting_city:          "Cidade",
  collecting_state:         "Estado",
  collecting_zipcode:       "CEP",
  asking_save_address:      "Salvar endereço",
  collecting_payment:       "Pagamento",
  collecting_card_brand:    "Bandeira",
  collecting_change:        "Troco",
  collecting_cpf:           "CPF",
  confirming_order:         "Confirmando pedido",
};

// ============================================================
// TOUR ONBOARDING
// ============================================================
const TOUR_KEY = "agente_tour_visto";

const TOUR_STEPS = [
  {
    emoji: "👋",
    titulo: "Bem-vindo ao Assistente!",
    desc: "Sou seu assistente de vendas inteligente. Posso ajudar a encontrar produtos, montar e finalizar seu pedido pelo chat.",
  },
  {
    emoji: "🔍",
    titulo: "Peça vários produtos de uma vez",
    desc: `Digite algo como "quero 2 ovos, macarrão e um toddy" — eu encontro tudo, mostro os preços e adiciono ao carrinho.`,
  },
  {
    emoji: "🛒",
    titulo: "Acompanhe seu carrinho",
    desc: "Toque no ícone do carrinho para ver os itens. O pedido é finalizado diretamente aqui no chat, sem sair da página.",
  },
  {
    emoji: "💾",
    titulo: "Conversa salva automaticamente",
    desc: "Pode fechar o app e voltar depois — sua conversa fica salva. Use o ícone 🗑️ no topo para limpar e começar uma nova.",
  },
];

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
const AgentePage: React.FC = () => {
  // --- Auth
  const [user, setUser]           = useState<User | null>(null);
  const [userDocId, setUserDocId] = useState<string | null>(null);
  const [nomeCliente, setNomeCliente] = useState("Cliente");
  const [authLoading, setAuthLoading] = useState(true);

  // --- Endereço salvo pelo agente
  const [enderecoSalvo, setEnderecoSalvo] = useState<EnderecoSalvo | null>(null);

  // --- Treinamento few-shot
  const [exemplosAtivos, setExemplosAtivos] = useState<ExemploConversa[]>([]);

  // Ref para controle de "salvar endereço" via pré-captura (independente de tag)
  const pendingSaveAddressRef = React.useRef(false);

  // Ref para forçar criação de pedido caso agente não emita [CONFIRM_ORDER]
  const pendingOrderConfirmRef = React.useRef(false);

  // Ref para últimos produtos mostrados — usado como fallback quando user diz "Sim"/"pode"
  const ultimosProdutosMostradosRef = React.useRef<Produto[]>([]);

  // --- Conversa (sessão no Firestore)
  const [conversaId, setConversaId] = useState<string | null>(null);

  // --- Domínio
  const [produtos, setProdutos]               = useState<Produto[]>([]);
  const [indiceCategoria, setIndiceCategoria] = useState<string>('');
  const [carrinho, setCarrinho]               = useState<CartItem[]>([]);
  const [flowState, setFlowState]             = useState<FlowState>(FLOW_STATES.BROWSING);
  const [customerData, setCustomerData]       = useState<CustomerData>({});

  // --- Chat
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [inputText, setInputText] = useState("");
  const [enviando, setEnviando]   = useState(false);
  const [listaPedidoState, setListaPedidoState] = useState<ListaPedidoState | null>(null);
  const [itemUnicoQtdState, setItemUnicoQtdState] = useState<ItemUnicoQuantidadeState | null>(null);

  // --- UI
  const [mostrarCarrinho, setMostrarCarrinho]   = useState(false);
  const [imagemAmpliada, setImagemAmpliada]     = useState<{ src: string; name: string; price: number } | null>(null);
  const [carregandoConversa, setCarregandoConversa] = useState(false);
  const [produtosCarregados, setProdutosCarregados] = useState(false);

  // --- Botão flutuante arrastável (carrinho)
  const [btnCartPos, setBtnCartPos]   = useState<{ x: number; y: number } | null>(null);
  const isDraggingCartRef             = useRef(false);
  const dragOffsetCartRef             = useRef({ x: 0, y: 0 });
  const dragMovedCartRef              = useRef(false);

  // --- Recuperação de carrinho ao recarregar
  const [cartRecoveryPending, setCartRecoveryPending] = useState(false);

  // --- Tour onboarding
  const [tourEtapa, setTourEtapa]     = useState<number | null>(null);
  const [tourIniciado, setTourIniciado] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);

  // -------- Scroll automático --------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  // -------- Botão flutuante: posição inicial --------
  useEffect(() => {
    setBtnCartPos({ x: window.innerWidth - 80, y: window.innerHeight - 150 });
  }, []);

  // -------- Botão flutuante: drag (mouse + touch) --------
  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDraggingCartRef.current) return;
      dragMovedCartRef.current = true;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const x = Math.max(0, Math.min(window.innerWidth  - 60, clientX - dragOffsetCartRef.current.x));
      const y = Math.max(0, Math.min(window.innerHeight - 60, clientY - dragOffsetCartRef.current.y));
      setBtnCartPos({ x, y });
    };
    const onEnd = () => { isDraggingCartRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchend", onEnd);
    };
  }, []);

  // -------- Autenticação --------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const snap = await getDocs(
            query(collection(db, "Users"), where("userAuthId", "==", currentUser.uid))
          );
          if (!snap.empty) {
            const d    = snap.docs[0];
            const data = d.data() as any;
            setUserDocId(d.id);
            setNomeCliente(montarNomeCompletoUsuario(data, currentUser));
          }
        } catch (e) {
          console.error("Erro ao buscar usuário:", e);
        }
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // -------- Carregar produtos + exemplos ativos + endereço salvo --------
  useEffect(() => {
    if (!user || !userDocId) return;
    getProducts()
      .then((data) => {
        setProdutos(data);
        setIndiceCategoria(buildIndiceCategoria(data));
        setProdutosCarregados(true);
      })
      .catch((e) => {
        console.error("Erro ao carregar produtos:", e);
        setProdutosCarregados(true);
      });
    carregarExemplosAtivos()
      .then(setExemplosAtivos)
      .catch(console.error);
    buscarEnderecoDefault(userDocId)
      .then(setEnderecoSalvo)
      .catch(console.error);
  }, [user, userDocId]);

  // -------- Tour: disparar após tudo carregado (1x por dispositivo) --------
  useEffect(() => {
    if (authLoading || carregandoConversa || mensagens.length === 0 || tourIniciado) return;
    const visto = localStorage.getItem(TOUR_KEY);
    if (!visto) {
      setTourIniciado(true);
      setTourEtapa(0);
    }
  }, [authLoading, carregandoConversa, mensagens.length, tourIniciado]);

  // -------- Iniciar sempre uma conversa nova na interface --------
  // Mantém o histórico no DB, mas não reidrata mensagens após recarregar a página.
  useEffect(() => {
    if (!userDocId || !produtosCarregados) return;

    (async () => {
      setCarregandoConversa(true);
      try {
        const conversaAtiva = await buscarConversaAtiva(userDocId);
        if (conversaAtiva) {
          // Encerra a conversa ativa para preservar histórico sem reaproveitar sessão.
          await atualizarConversa(userDocId, conversaAtiva.conversaId, {
            status:  "abandonada",
            endedAt: Timestamp.now(),
          });
        }
        // Reinicia apenas a interface/sessão local.
        setConversaId(null);
        setFlowState(FLOW_STATES.BROWSING);
        setCarrinho([]);
        setCustomerData({});
        setCartRecoveryPending(false);
        setMensagens([{
          id:        "welcome",
          role:      "assistant",
          content:   `Olá, ${nomeCliente}! Tudo bem? 👋\nSou o assistente do Supermercado.\n\nPosso te ajudar a encontrar produtos e montar seu pedido rapidamente.\n\nQual produto você está procurando agora?\n\nSe preferir, cole sua lista de compras aqui e eu encontro tudo para você.`,
          timestamp: new Date(),
        }]);
      } catch (e) {
        console.error("Erro ao iniciar nova conversa:", e);
        // Fallback: boas-vindas
        setMensagens([{
          id:        "welcome",
          role:      "assistant",
          content:   `Olá, ${nomeCliente}! Tudo bem? 👋\nSou o assistente do Supermercado.\n\nPosso te ajudar a encontrar produtos e montar seu pedido rapidamente.\n\nQual produto você está procurando agora?\n\nSe preferir, cole sua lista de compras aqui e eu encontro tudo para você.`,
          timestamp: new Date(),
        }]);
      } finally {
        setCarregandoConversa(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDocId, produtosCarregados]);

  // handleCreateOrder foi movido para inline em enviarMensagem

  // -------- Limpar conversa --------
  const limparConversa = async () => {
    if (conversaId && userDocId) {
      try {
        await atualizarConversa(userDocId, conversaId, {
          status:  "abandonada",
          endedAt: Timestamp.now(),
        });
      } catch (e) {
        console.error("Erro ao encerrar conversa:", e);
      }
    }
    setConversaId(null);
    setCarrinho([]);
    setFlowState(FLOW_STATES.BROWSING);
    setCustomerData({});
    setListaPedidoState(null);
    setItemUnicoQtdState(null);
    setMensagens([{
      id:        "welcome",
      role:      "assistant",
      content:   `Olá, ${nomeCliente}! Tudo bem? 👋\nSou o assistente do Supermercado.\n\nPosso te ajudar a encontrar produtos e montar seu pedido rapidamente.\n\nQual produto você está procurando agora?\n\nSe preferir, cole sua lista de compras aqui e eu encontro tudo para você.`,
      timestamp: new Date(),
    }]);
  };

  useEffect(() => {
    if (flowState !== FLOW_STATES.BROWSING && listaPedidoState) {
      setListaPedidoState(null);
    }
    if (flowState !== FLOW_STATES.BROWSING && itemUnicoQtdState) {
      setItemUnicoQtdState(null);
    }
  }, [flowState, listaPedidoState, itemUnicoQtdState]);

  // -------- Avançar tour --------
  const proximaTour = () => {
    if (tourEtapa === null) return;
    if (tourEtapa < TOUR_STEPS.length - 1) {
      setTourEtapa(tourEtapa + 1);
    } else {
      localStorage.setItem(TOUR_KEY, "true");
      setTourEtapa(null);
    }
  };

  const fecharTour = () => {
    localStorage.setItem(TOUR_KEY, "true");
    setTourEtapa(null);
  };

  // -------- Enviar mensagem --------
  const enviarMensagem = async (textoOverride?: string) => {
    const texto = textoOverride ?? inputText.trim();
    if (!texto || enviando) return;

    if (!textoOverride) setInputText("");

    const msgUsuario: Mensagem = {
      id:        `user-${Date.now()}`,
      role:      "user",
      content:   texto,
      timestamp: new Date(),
    };
    setMensagens((prev) => [...prev, msgUsuario]);
    setEnviando(true);

    // ---- Variáveis de trabalho sincronas (evitam stale closure) ----
    // Espelham o React state e são atualizadas imediatamente ao processar tags.
    let wFlowState    = flowState;
    let wCart         = [...carrinho];
    let wCustomerData = { ...customerData };

    // ---- Pré-captura direta nos estados de coleta ----
    // Garante que o dado seja salvo mesmo que o agente não emita a tag [SET_*].
    const collectingField = COLLECTING_FIELD[wFlowState];
    if (collectingField !== undefined) {
      const rawValor = texto.trim();
      let valor = rawValor.toLowerCase() === 'none' ? '' : rawValor;

      if (collectingField === 'paymentType') {
        const t = rawValor.toLowerCase();
        if (t.includes('pix'))                                   valor = 'Pix';
        else if (t.includes('dinheiro'))                         valor = 'Dinheiro';
        else if (t.includes('débito') || t.includes('debito'))   valor = 'Cartão Débito';
        else if (t.includes('crédito') || t.includes('credito')) valor = 'Cartão Crédito';
        wCustomerData = { ...wCustomerData, [collectingField]: valor };
        // Próximo estado condicional ao tipo de pagamento
        wFlowState = nextStateAfterPayment(valor);
      } else if (collectingField === 'cpf') {
        // CPF só é salvo se parecer numérico (9+ dígitos) — caso contrário, trata como "sem CPF"
        const digits = rawValor.replace(/\D/g, '');
        valor = digits.length >= 9 ? rawValor : '';
        wCustomerData = { ...wCustomerData, cpf: valor };
        const next = NEXT_STATE[wFlowState];
        if (next) wFlowState = next;
      } else {
        wCustomerData = { ...wCustomerData, [collectingField]: valor };
        const next = NEXT_STATE[wFlowState];
        if (next) wFlowState = next;
      }
      setCustomerData(wCustomerData);
      setFlowState(wFlowState);
    }

    // Pré-captura para CHECKING_SAVED_ADDRESS (usar endereço salvo ou informar novo)
    if (flowState === FLOW_STATES.CHECKING_SAVED_ADDRESS) {
      const val = texto.toLowerCase().trim();
      const usarSalvoWords = ['sim', 'yes', 's', 'usar', 'esse', 'mesmo', 'salvo', 'pode', 'ok', 'quero', 'claro'];
      const novoEnderecoWords = ['não', 'nao', 'novo', 'nova', 'outro', 'outra', 'diferente', 'mudar', 'alterar', 'trocar'];
      if (novoEnderecoWords.some(w => val.includes(w))) {
        wFlowState = FLOW_STATES.COLLECTING_STREET;
        setFlowState(wFlowState);
      } else if (usarSalvoWords.some(w => val === w || val.startsWith(w + ' ')) && enderecoSalvo) {
        wCustomerData = {
          ...wCustomerData,
          street:       enderecoSalvo.street,
          number:       enderecoSalvo.number,
          neighborhood: enderecoSalvo.neighborhood,
          city:         enderecoSalvo.city,
          zipCode:      enderecoSalvo.zipCode,
        };
        wFlowState = FLOW_STATES.COLLECTING_PAYMENT;
        setCustomerData(wCustomerData);
        setFlowState(wFlowState);
      }
    }

    // Pré-captura para ASKING_SAVE_ADDRESS (sim/não → avança para pagamento)
    if (flowState === FLOW_STATES.ASKING_SAVE_ADDRESS) {
      const val = texto.toLowerCase().trim();
      const simWords = ['sim', 'yes', 's', 'claro', 'pode', 'quero', 'salva'];
      pendingSaveAddressRef.current = simWords.some(w => val.includes(w));
      wFlowState = FLOW_STATES.COLLECTING_PAYMENT;
      setFlowState(wFlowState);
    }

    // Pré-captura para CONFIRMING_ORDER: "1"/"sim" confirma, "2"/"não" cancela
    if (flowState === FLOW_STATES.CONFIRMING_ORDER) {
      const val = texto.toLowerCase().trim().replace(/[.!?]/g, '');
      const confirmWords = ['1', 'sim', 'confirmar', 'confirmo', 'ok', 'pode', 'claro', 'quero', 'yes', 's'];
      const cancelWords  = ['2', 'não', 'nao', 'cancelar', 'cancelo', 'nope', 'no'];
      if (confirmWords.includes(val)) {
        pendingOrderConfirmRef.current = true;
        // Estado permanece CONFIRMING_ORDER para o agente confirmar a ação
      } else if (cancelWords.some(w => val === w || val.startsWith(w + ' '))) {
        wFlowState    = FLOW_STATES.BROWSING;
        wCustomerData = {};
        setFlowState(wFlowState);
        setCustomerData({});
      }
    }

    const flowStateAntes = flowState; // estado original antes de qualquer mudança

    try {
      // Criar conversa na primeira mensagem
      let cid = conversaId;
      if (!cid && userDocId) {
        cid = await criarConversa(userDocId, nomeCliente, flowStateAntes);
        setConversaId(cid);
      }

      // Salvar mensagem do usuário
      if (cid && userDocId) {
        await salvarMensagem(
          cid, userDocId, 'user', texto,
          flowStateAntes, wFlowState, [], [], null
        );
      }

      const salvarRespostaLocal = async (
        content: string,
        produtosCard?: Produto[],
        suggestions?: string[]
      ) => {
        const contentFormatado = limparMarkdownBasico(content);
        setMensagens((prev) => [
          ...prev,
          {
            id: `assistant-local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: "assistant",
            content: contentFormatado,
            timestamp: new Date(),
            produtosCard: produtosCard && produtosCard.length > 0 ? produtosCard : undefined,
            suggestions: suggestions && suggestions.length > 0 ? suggestions : undefined,
          },
        ]);
        if (cid && userDocId) {
          await salvarMensagem(
            cid,
            userDocId,
            "assistant",
            contentFormatado,
            flowStateAntes,
            wFlowState,
            [],
            (produtosCard ?? []).map((p) => p.id),
            null
          );
          await atualizarConversa(userDocId, cid, {
            flowStateAtual: wFlowState,
            carrinhoFinal: wCart,
            customerDataColetado: wCustomerData,
          });
        }
      };

      const sincronizarDiffCarrinhoLocal = (cartAntes: CartItem[], cartDepois: CartItem[]) => {
        if (!userDocId) return;
        for (const novoItem of cartDepois) {
          const itemAnterior = cartAntes.find(i => i.id === novoItem.id);
          if (!itemAnterior || itemAnterior.quantity !== novoItem.quantity) {
            sincronizarItemCarrinho(userDocId, novoItem).catch(console.error);
          }
        }
        for (const itemAnterior of cartAntes) {
          if (!cartDepois.find(i => i.id === itemAnterior.id)) {
            removerItemCarrinhoFirestore(userDocId, itemAnterior.id).catch(console.error);
          }
        }
      };

      const adicionarItemAoCarrinhoLocal = (cartAtual: CartItem[], produto: Produto, quantidade: number): CartItem[] => {
        const existente = cartAtual.find((i) => i.id === produto.id);
        if (existente) {
          return cartAtual.map((i) =>
            i.id === produto.id ? { ...i, quantity: i.quantity + quantidade } : i
          );
        }
        return [...cartAtual, { ...produto, quantity: quantidade }];
      };

      const proximoIndicePendente = (itens: ListaPedidoItem[], atual: number): number => {
        for (let i = atual + 1; i < itens.length; i++) {
          if (!itens[i].selecionadoId && !itens[i].cancelado) return i;
        }
        return -1;
      };

      const montarMensagemSelecaoItem = (estado: ListaPedidoState, item: ListaPedidoItem, index: number) => {
        const opcoes = item.candidatos.slice(0, 5);
        const sufixoLista = estado.itens.length > 1 ? ` (item ${index + 1} de ${estado.itens.length})` : "";
        return {
          texto: `Estas são as opções de ${item.termoBusca} que temos hoje${sufixoLista}. Para adicionar no pedido é só clicar no "+" ao lado do produto.`,
          produtosCard: opcoes,
          suggestions: ["Cancelar item"],
        };
      };

      if (wFlowState === FLOW_STATES.BROWSING) {
        const textoNormalizado = normalizar(texto);
        const itensExtraidos = extrairItensListaComQuantidade(texto);
        const itemUnicoExtraido = itensExtraidos.length === 1 ? itensExtraidos[0] : null;
        const podeIniciarLista = !listaPedidoState && itensExtraidos.length >= 2;

        if (itemUnicoQtdState) {
          if (ehCancelamento(texto) || textoNormalizado.includes("cancelar")) {
            setItemUnicoQtdState(null);
            await salvarRespostaLocal("Tudo bem, selecao cancelada.");
            return;
          }

          if (itemUnicoQtdState.stage === "confirm_single" && itemUnicoQtdState.produtoSugerido) {
            const confirmarMesmo =
              ehConfirmacaoPositiva(texto) ||
              textoNormalizado.includes("esse") ||
              textoNormalizado.includes("mesmo");
            const escolherOutro =
              textoNormalizado.includes("outro") ||
              textoNormalizado.includes("marca") ||
              textoNormalizado.includes("tipo");

            if (confirmarMesmo) {
              const cartAntes = [...wCart];
              wCart = adicionarItemAoCarrinhoLocal(wCart, itemUnicoQtdState.produtoSugerido, itemUnicoQtdState.quantidade);
              setCarrinho(wCart);
              sincronizarDiffCarrinhoLocal(cartAntes, wCart);
              setItemUnicoQtdState(null);
              await salvarRespostaLocal(
                `Perfeito! Adicionei ${itemUnicoQtdState.quantidade}x ${itemUnicoQtdState.produtoSugerido.name} ao carrinho.`,
                [itemUnicoQtdState.produtoSugerido],
                ["Finalizar compra", "Continuar comprando"]
              );
              return;
            }

            if (escolherOutro) {
              const alternativas = buscarAlternativasPorTermo(
                itemUnicoQtdState.termoBusca,
                produtos,
                itemUnicoQtdState.produtoSugerido.id
              );
              const novoEstado: ItemUnicoQuantidadeState = {
                ...itemUnicoQtdState,
                stage: "choose_other",
                candidatos: alternativas.length > 0 ? alternativas : itemUnicoQtdState.candidatos,
              };
              setItemUnicoQtdState(novoEstado);
              await salvarRespostaLocal(
                `Estas são as opções de ${itemUnicoQtdState.termoBusca} que temos hoje. Para adicionar no pedido é só clicar no "+" ao lado do produto.`,
                novoEstado.candidatos,
                ["Cancelar"]
              );
              return;
            }

            await salvarRespostaLocal(
              `Esta é a opção de ${itemUnicoQtdState.termoBusca} que temos hoje. Para adicionar no pedido é só clicar no "+" ao lado do produto.`,
              [itemUnicoQtdState.produtoSugerido],
              ["Outro tipo/marca", "Cancelar"]
            );
            return;
          }

          const indiceEscolhido = encontrarIndiceEscolhido(texto, itemUnicoQtdState.candidatos.length);
          const escolhido = indiceEscolhido !== null
            ? itemUnicoQtdState.candidatos[indiceEscolhido]
            : itemUnicoQtdState.candidatos.find((c) => {
                const nome = normalizar(c.name);
                return textoNormalizado.includes(nome) || nome.includes(textoNormalizado);
              });

          if (escolhido) {
            const cartAntes = [...wCart];
            wCart = adicionarItemAoCarrinhoLocal(wCart, escolhido, itemUnicoQtdState.quantidade);
            setCarrinho(wCart);
            sincronizarDiffCarrinhoLocal(cartAntes, wCart);
            setItemUnicoQtdState(null);
            await salvarRespostaLocal(
              `Perfeito! Adicionei ${itemUnicoQtdState.quantidade}x ${escolhido.name} ao carrinho.`,
              [escolhido],
              ["Finalizar compra", "Continuar comprando"]
            );
            return;
          }

          await salvarRespostaLocal(
            `Estas são as opções de ${itemUnicoQtdState.termoBusca} que temos hoje. Para adicionar no pedido é só clicar no "+" ao lado do produto.`,
            itemUnicoQtdState.candidatos.slice(0, 6),
            ["Cancelar"]
          );
          return;
        }

        if (!listaPedidoState && itemUnicoExtraido) {
          const candidatosItemUnico = filtrarProdutos(itemUnicoExtraido.termoBusca, produtos).slice(0, 6);
          if (candidatosItemUnico.length > 1) {
            const novoEstadoUnico: ItemUnicoQuantidadeState = {
              termoBusca: itemUnicoExtraido.termoBusca,
              quantidade: itemUnicoExtraido.quantidade,
              stage: "choose_other",
              candidatos: candidatosItemUnico,
            };
            setItemUnicoQtdState(novoEstadoUnico);
            await salvarRespostaLocal(
              `Estas são as opções de ${itemUnicoExtraido.termoBusca} que temos hoje. Para adicionar no pedido é só clicar no "+" ao lado do produto.`,
              candidatosItemUnico,
              ["Cancelar"]
            );
            return;
          }

          if (candidatosItemUnico.length === 1) {
            const sugerido = candidatosItemUnico[0];
            setItemUnicoQtdState({
              termoBusca: itemUnicoExtraido.termoBusca,
              quantidade: itemUnicoExtraido.quantidade,
              stage: "confirm_single",
              candidatos: candidatosItemUnico,
              produtoSugerido: sugerido,
            });
            await salvarRespostaLocal(
              `Esta é a opção de ${itemUnicoExtraido.termoBusca} que temos hoje. Para adicionar no pedido é só clicar no "+" ao lado do produto.`,
              [sugerido],
              ["Outro tipo/marca", "Cancelar"]
            );
            return;
          }
        }

        if (listaPedidoState || podeIniciarLista) {
          const estadoAtual: ListaPedidoState = listaPedidoState
            ? { ...listaPedidoState, itens: listaPedidoState.itens.map((it) => ({ ...it })) }
            : {
                stage: "await_confirm",
                currentIndex: 0,
                itens: itensExtraidos.map((it) => ({
                  ...it,
                  candidatos: filtrarProdutos(it.termoBusca, produtos).slice(0, 6),
                })),
              };

          if (!listaPedidoState) {
            const produtosResumo = estadoAtual.itens
              .map((it) => it.candidatos[0])
              .filter((p): p is Produto => Boolean(p))
              .slice(0, 6);
            const resumo = estadoAtual.itens
              .map((it, i) => `${i + 1}. ${it.quantidade}x ${it.termoBusca}${it.candidatos.length === 0 ? " (sem variedade encontrada agora)" : ""}`)
              .join("\n");

            setListaPedidoState(estadoAtual);
            await salvarRespostaLocal(
              `Perfeito! Entendi esta lista:\n${resumo}\n\nEsta correta?`,
              produtosResumo,
              ["Confirmar lista", "Editar lista", "Cancelar"]
            );
            return;
          }

          if (estadoAtual.stage === "await_confirm") {
            if (ehConfirmacaoPositiva(texto)) {
              estadoAtual.stage = "await_mode";
              setListaPedidoState(estadoAtual);
              await salvarRespostaLocal(
                "Como voce deseja adicionar os itens ao carrinho?",
                undefined,
                ["Preencher automaticamente (mais populares)", "Escolher variedade de cada item"]
              );
              return;
            }

            if (textoNormalizado.includes("editar")) {
              setListaPedidoState(null);
              await salvarRespostaLocal("Perfeito. Me envie a lista corrigida com as quantidades que eu processo novamente.");
              return;
            }

            if (ehCancelamento(texto)) {
              setListaPedidoState(null);
              await salvarRespostaLocal("Lista cancelada. Se quiser, envie novamente a lista com quantidades.");
              return;
            }

            const resumo = estadoAtual.itens
              .map((it, i) => `${i + 1}. ${it.quantidade}x ${it.termoBusca}`)
              .join("\n");
            await salvarRespostaLocal(
              `So para confirmar, esta e a sua lista:\n${resumo}`,
              undefined,
              ["Confirmar lista", "Editar lista", "Cancelar"]
            );
            return;
          }

          if (estadoAtual.stage === "await_mode") {
            if (ehEscolhaAutomatica(texto)) {
              const cartAntes = [...wCart];
              const escolhidos: Produto[] = [];

              for (const item of estadoAtual.itens) {
                const escolhido = item.candidatos[0];
                if (!escolhido) {
                  item.cancelado = true;
                  continue;
                }
                item.selecionadoId = escolhido.id;
                escolhidos.push(escolhido);
                wCart = adicionarItemAoCarrinhoLocal(wCart, escolhido, item.quantidade);
              }

              setCarrinho(wCart);
              sincronizarDiffCarrinhoLocal(cartAntes, wCart);
              setListaPedidoState(null);

              const resumoAdd = estadoAtual.itens
                .map((item) => {
                  const p = item.candidatos.find((c) => c.id === item.selecionadoId);
                  if (!p) return `- ${item.quantidade}x ${item.termoBusca} (sem produto correspondente)`;
                  return `- ${item.quantidade}x ${p.name}`;
                })
                .join("\n");

              await salvarRespostaLocal(
                `Pronto! Preenchi automaticamente com as opcoes mais populares:\n${resumoAdd}\n\nDeseja finalizar a compra, alterar algum item ou continuar comprando?`,
                escolhidos.slice(0, 6),
                ["Finalizar compra", "Alterar algum item", "Continuar comprando"]
              );
              return;
            }

            if (ehEscolhaVariacao(texto)) {
              estadoAtual.stage = "selecting_variant";
              estadoAtual.currentIndex = 0;
              setListaPedidoState(estadoAtual);

              const itemAtual = estadoAtual.itens[0];
              if (!itemAtual || itemAtual.candidatos.length === 0) {
                estadoAtual.stage = "await_next_item";
                setListaPedidoState(estadoAtual);
                await salvarRespostaLocal(
                  `Item 1/${estadoAtual.itens.length}: ${itemAtual?.quantidade ?? 0}x ${itemAtual?.termoBusca ?? "item"}\nNao encontrei variedades disponiveis para este item.\n\nDeseja ir para o proximo item da lista ou cancelar?`,
                  undefined,
                  ["Proximo item", "Cancelar lista"]
                );
                return;
              }

              const msg = montarMensagemSelecaoItem(estadoAtual, itemAtual, 0);
              await salvarRespostaLocal(msg.texto, msg.produtosCard, msg.suggestions);
              return;
            }

            await salvarRespostaLocal(
              "Escolha uma opcao para continuar:",
              undefined,
              ["Preencher automaticamente (mais populares)", "Escolher variedade de cada item"]
            );
            return;
          }

          if (estadoAtual.stage === "selecting_variant") {
            const idx = estadoAtual.currentIndex;
            const itemAtual = estadoAtual.itens[idx];

            if (!itemAtual) {
              setListaPedidoState(null);
              await salvarRespostaLocal(`Resumo final do carrinho:\n${formatarResumoCarrinho(wCart)}`);
              return;
            }

            if (textoNormalizado.includes("cancelar item")) {
              itemAtual.cancelado = true;
              estadoAtual.stage = "await_next_item";
              setListaPedidoState(estadoAtual);
              await salvarRespostaLocal(
                `Item "${itemAtual.termoBusca}" cancelado.\n\nDeseja ir para o proximo item da lista ou cancelar?`,
                undefined,
                ["Proximo item", "Cancelar lista"]
              );
              return;
            }

            const indiceEscolhido = encontrarIndiceEscolhido(texto, itemAtual.candidatos.length);
            const escolhido = indiceEscolhido !== null
              ? itemAtual.candidatos[indiceEscolhido]
              : itemAtual.candidatos.find((c) => normalizar(c.name).includes(textoNormalizado) || textoNormalizado.includes(normalizar(c.name)));

            if (!escolhido) {
              const msg = montarMensagemSelecaoItem(estadoAtual, itemAtual, idx);
              await salvarRespostaLocal(
                `${msg.texto}\n\nSe preferir, toque em "Cancelar item".`,
                msg.produtosCard,
                msg.suggestions
              );
              return;
            }

            const cartAntes = [...wCart];
            wCart = adicionarItemAoCarrinhoLocal(wCart, escolhido, itemAtual.quantidade);
            setCarrinho(wCart);
            sincronizarDiffCarrinhoLocal(cartAntes, wCart);

            itemAtual.selecionadoId = escolhido.id;
            estadoAtual.stage = "await_next_item";
            setListaPedidoState(estadoAtual);
            await salvarRespostaLocal(
              `Adicionei ${itemAtual.quantidade}x ${escolhido.name} ao carrinho.\n\nDeseja ir para o proximo item da lista ou cancelar?`,
              [escolhido],
              ["Proximo item", "Cancelar lista"]
            );
            return;
          }

          if (estadoAtual.stage === "await_next_item") {
            if (ehCancelamento(texto) || textoNormalizado.includes("cancelar lista")) {
              setListaPedidoState(null);
              await salvarRespostaLocal(
                `Lista encerrada.\n\nResumo final do carrinho:\n${formatarResumoCarrinho(wCart)}`,
                undefined,
                ["Finalizar compra", "Continuar comprando"]
              );
              return;
            }

            if (textoNormalizado.includes("proximo") || textoNormalizado.includes("próximo") || textoNormalizado === "1") {
              const prox = proximoIndicePendente(estadoAtual.itens, estadoAtual.currentIndex);
              if (prox === -1) {
                const cardsFinal = estadoAtual.itens
                  .map((it) => it.candidatos.find((c) => c.id === it.selecionadoId))
                  .filter((p): p is Produto => Boolean(p))
                  .slice(0, 6);
                setListaPedidoState(null);
                await salvarRespostaLocal(
                  `Todos os itens da lista foram processados.\n\nResumo final do carrinho:\n${formatarResumoCarrinho(wCart)}`,
                  cardsFinal,
                  ["Finalizar compra", "Continuar comprando"]
                );
                return;
              }

              estadoAtual.currentIndex = prox;
              estadoAtual.stage = "selecting_variant";
              setListaPedidoState(estadoAtual);
              const itemProx = estadoAtual.itens[prox];

              if (itemProx.candidatos.length === 0) {
                estadoAtual.stage = "await_next_item";
                setListaPedidoState(estadoAtual);
                await salvarRespostaLocal(
                  `Item ${prox + 1}/${estadoAtual.itens.length}: ${itemProx.quantidade}x ${itemProx.termoBusca}\nNao encontrei variedades disponiveis para este item.\n\nDeseja ir para o proximo item da lista ou cancelar?`,
                  undefined,
                  ["Proximo item", "Cancelar lista"]
                );
                return;
              }

              const msg = montarMensagemSelecaoItem(estadoAtual, itemProx, prox);
              await salvarRespostaLocal(msg.texto, msg.produtosCard, msg.suggestions);
              return;
            }

            await salvarRespostaLocal(
              "Escolha uma opcao para continuar a lista:",
              undefined,
              ["Proximo item", "Cancelar lista"]
            );
            return;
          }
        }

        // Interceptar "Continuar comprando" antes da IA
        if (ehAcaoContinuarComprando(texto)) {
          const frases = [
            `Ótimo! 😄 Ainda tem muita coisa boa aqui. O que mais posso separar para você hoje?`,
            `Que bom! 🛒 Aproveite enquanto estamos abertos — o que mais você precisa?`,
            `Com prazer! 😊 Me conta o que mais está precisando e eu encontro rapidinho!`,
            `Perfeito! ✨ Tem mais alguma coisa na lista? Pode digitar que eu busco aqui pra você.`,
          ];
          const resposta = frases[Math.floor(Math.random() * frases.length)];
          await salvarRespostaLocal(resposta);
          return;
        }
      }

      // Histórico para a API
      const MAX_HIST = wFlowState === FLOW_STATES.BROWSING ? 8 : 4;
      const historico = [...mensagens, msgUsuario]
        .filter((m) => m.id !== "welcome")
        .slice(-MAX_HIST)
        .map((m) => ({ role: m.role, content: m.content }));

      // Produtos relevantes (só na navegação)
      let produtosFoco: Produto[] = [];
      let produtosMatchDireto: Produto[] = [];
      if (wFlowState === FLOW_STATES.BROWSING) {
        const filtrado = filtrarProdutos(texto, produtos);
        produtosMatchDireto = filtrado;
        if (filtrado.length > 0) {
          // Mantém os matches no topo, mas adiciona diversidade para o agente
          // conseguir sugerir alternativas quando faltar algum item pedido.
          produtosFoco = combinarProdutosFoco(filtrado.slice(0, 14), produtos, 20);
        } else {
          const palavrasLongas = normalizar(texto).split(/\s+/).filter(w => w.length >= 4);
          const pareceBuscaNova = palavrasLongas.length >= 2;
          if (!pareceBuscaNova && !ehSaudacaoCurta(texto)) {
            // Confirmação curta ("sim", "1", "pode"): reutiliza últimos produtos mostrados
            produtosFoco = ultimosProdutosMostradosRef.current;
          } else {
            // Busca sem resultados diretos: fornece amostra por categoria para o agente
            // ter IDs reais e não inventar produtos
            const porCategoria = new Map<string, Produto[]>();
            for (const p of produtos) {
              const cat = p.categoryId || p.category;
              if (!porCategoria.has(cat)) porCategoria.set(cat, []);
              porCategoria.get(cat)!.push(p);
            }
            const amostra: Produto[] = [];
            for (const prods of porCategoria.values()) {
              amostra.push(...prods.slice(0, 3));
              if (amostra.length >= 20) break;
            }
            produtosFoco = amostra.slice(0, 20);
          }
        }
      }

      // Few-shot
      const fewShot: FewShotExemplo[] = exemplosAtivos.map((ex) => ({
        mensagens: ex.mensagens.map((m) => ({ role: m.role, content: m.content })),
      }));

      const openai = new OpenAI({
        apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
        dangerouslyAllowBrowser: true,
      });

      // Prompt construído com o estado de trabalho atualizado
      const systemPrompt = buildSystemPrompt(
        produtosFoco,
        wFlowState === FLOW_STATES.BROWSING ? indiceCategoria : '',
        wCart,
        wFlowState,
        wCustomerData,
        nomeCliente,
        enderecoSalvo,
        DELIVERY_PRICE,
        fewShot
      );

      // ---- Streaming ----
      const tempId = `agent-stream-${Date.now()}`;
      let rawText = "";
      let streamStarted = false;

      const stream = await openai.chat.completions.create({
        model:       "gpt-4o-mini",
        messages:    [{ role: "system", content: systemPrompt }, ...historico],
        temperature: 0.7,
        max_tokens:  350,
        stream:      true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (!delta) continue;
        rawText += delta;

        if (!streamStarted) {
          streamStarted = true;
          // NÃO libera o input aqui — setEnviando(false) fica no finally,
          // após setCarrinho, para evitar race condition com cart vazio
          setMensagens(prev => [...prev, {
            id: tempId, role: "assistant" as const,
            content: "", timestamp: new Date(),
          }]);
        }

        const displayText = limparMarkdownBasico(rawText.replace(/\[[^\]]*(?:\]|$)/g, "").trim());
        setMensagens(prev =>
          prev.map(m => m.id === tempId ? { ...m, content: displayText || "..." } : m)
        );
      }

      if (!streamStarted) {
        setMensagens(prev => [...prev, {
          id: tempId, role: "assistant" as const,
          content: "", timestamp: new Date(),
        }]);
      }

      // ---- Processar resposta completa (função pura — retorna novo estado) ----
      const tagsDetectadas = (rawText.match(/\[[A-Z_]+(?::[^\]]+)?\]/g) ?? []);
      let produtosCardIds = (rawText.match(/\[(?:SHOW|ADD):([^:\]]+)/g) ?? [])
        .map((t) => t.replace(/\[(?:SHOW|ADD):/, ''));

      const resultado = parseAgentResponse(
        rawText, produtos, wCart, wFlowState, wCustomerData, enderecoSalvo
      );


      const respostaPareceListagem =
        /(?:^|\n)\s*\d+\.\s+.+/m.test(resultado.cleanText) ||
        /R\$\s*\d/.test(resultado.cleanText);
      const termosBuscaUsuario = extrairPalavrasBaseBusca(texto);
      const candidatosFallback = produtosMatchDireto.length > 0 ? produtosMatchDireto : produtosFoco;
      const precisaFallbackCards =
        resultado.produtosParaMostrar.length === 0 &&
        wFlowState === FLOW_STATES.BROWSING &&
        !ehSaudacaoCurta(texto) &&
        candidatosFallback.length > 0 &&
        (respostaPareceListagem || termosBuscaUsuario.length > 0);

      const produtosParaExibirBase = precisaFallbackCards
        ? selecionarCardsPorTermos(termosBuscaUsuario, candidatosFallback, 6)
        : resultado.produtosParaMostrar;
      const bloquearSomenteFallbackNesteTurno =
        ehSaudacaoCurta(texto) ||
        ehAcaoContinuarComprando(texto) ||
        ehAcaoAlterarItem(texto) ||
        ehIntencaoCheckout(texto) ||
        resultado.newFlowState !== FLOW_STATES.BROWSING;
      const produtosParaExibir =
        resultado.produtosParaMostrar.length > 0
          ? resultado.produtosParaMostrar
          : (bloquearSomenteFallbackNesteTurno ? [] : produtosParaExibirBase);

      if (produtosCardIds.length === 0 && produtosParaExibir.length > 0) {
        produtosCardIds = produtosParaExibir.map((p) => p.id);
      }

      // Atualizar ref de últimos produtos mostrados (para contexto de confirmação "Sim")
      if (produtosParaExibir.length > 0) {
        ultimosProdutosMostradosRef.current = produtosParaExibir;
      }

      // Aplicar mudanças ao estado de trabalho E ao React state
      const cartAntes = wCart;
      wCart         = resultado.newCart;
      wFlowState    = resultado.newFlowState;
      wCustomerData = resultado.newCustomerData;
      setCarrinho(resultado.newCart);
      setFlowState(resultado.newFlowState);
      setCustomerData(resultado.newCustomerData);

      // ---- Sincronizar carrinho no Firestore (fire-and-forget) ----
      if (userDocId) {
        // Itens adicionados ou com quantidade alterada
        for (const novoItem of resultado.newCart) {
          const itemAnterior = cartAntes.find(i => i.id === novoItem.id);
          if (!itemAnterior || itemAnterior.quantity !== novoItem.quantity) {
            sincronizarItemCarrinho(userDocId, novoItem).catch(console.error);
          }
        }
        // Itens removidos
        for (const itemAnterior of cartAntes) {
          if (!resultado.newCart.find(i => i.id === itemAnterior.id)) {
            removerItemCarrinhoFirestore(userDocId, itemAnterior.id).catch(console.error);
          }
        }
      }

      // Calcular forcarPedido ANTES do setMensagens (precisa do ref antes de resetar)
      const forcarPedido = pendingOrderConfirmRef.current && !resultado.shouldCreateOrder;

      // Substituir mensagem temporária pela versão final com cards
      // Se cleanText for vazio (agente só emitiu tags), remove o placeholder silenciosamente
      const cleanTextFormatado = limparMarkdownBasico(resultado.cleanText);
      if (cleanTextFormatado) {
        setMensagens(prev =>
          prev.map(m =>
            m.id === tempId
              ? {
                  ...m,
                  content:      cleanTextFormatado,
                  produtosCard: produtosParaExibir.length > 0
                    ? produtosParaExibir
                    : undefined,
                  suggestions:  resultado.suggestions.length > 0
                    ? resultado.suggestions
                    : undefined,
                }
              : m
          )
        );
      } else {
        setMensagens(prev => prev.filter(m => m.id !== tempId));
      }

      // ---- Salvar endereço (se agente ou pré-captura indicou) ----
      if ((resultado.shouldSaveAddress || pendingSaveAddressRef.current) && userDocId && wCustomerData.street) {
        pendingSaveAddressRef.current = false;
        try {
          await salvarEnderecoDefault(userDocId, wCustomerData);
          setEnderecoSalvo({
            street:       wCustomerData.street       ?? '',
            number:       wCustomerData.number       ?? '',
            neighborhood: wCustomerData.neighborhood ?? '',
            city:         wCustomerData.city         ?? '',
            state:        wCustomerData.state        ?? '',
            zipCode:      wCustomerData.zipCode      ?? '',
          });
        } catch (e) {
          console.error("Erro ao salvar endereço:", e);
        }
      }

      // ---- Criar pedido (via tag do agente OU confirmação de pré-captura) ----
      pendingOrderConfirmRef.current = false;
      if ((resultado.shouldCreateOrder || forcarPedido) && userDocId) {
        try {
          wCustomerData = { ...wCustomerData, name: nomeCliente };
          setCustomerData(wCustomerData);
          const orderResult = await createOrder(wCustomerData, wCart, userDocId, nomeCliente);

          // Registrar na conversa
          if (cid) {
            await atualizarConversa(userDocId, cid, {
              status:               'pedido_realizado',
              pedidoGerado:         true,
              pedidoId:             orderResult.id,
              pedidoOrderNumber:    orderResult.orderNumber,
              pedidoTotal:          orderResult.total,
              carrinhoFinal:        wCart,
              customerDataColetado: wCustomerData,
              flowStateAtual:       FLOW_STATES.BROWSING,
              endedAt:              Timestamp.now(),
            });
          }

          // Resetar estado e limpar carrinho no Firestore
          wFlowState    = FLOW_STATES.BROWSING;
          wCart         = [];
          wCustomerData = {};
          setFlowState(FLOW_STATES.BROWSING);
          setCarrinho([]);
          setCustomerData({});
          if (userDocId) {
            limparCarrinhoFirestore(userDocId).catch(console.error);
          }

          // Mensagem de confirmação no chat
          setMensagens(prev => [...prev, {
            id:        `pedido-${orderResult.id}`,
            role:      "assistant" as const,
            content:   `✅ Pedido #${orderResult.orderNumber} confirmado!\nTotal: R$ ${orderResult.total.toFixed(2)}\n\nObrigado pela preferência! Posso ajudar com mais alguma coisa? 😊`,
            timestamp: new Date(),
          }]);
        } catch (orderErr) {
          console.error("Erro ao criar pedido:", orderErr);
          setMensagens(prev => [...prev, {
            id:        `pedido-err-${Date.now()}`,
            role:      "assistant" as const,
            content:   "❌ Tive um problema ao confirmar seu pedido. Tente novamente ou entre em contato conosco.",
            timestamp: new Date(),
          }]);
        }
      }

      // ---- Salvar no Firestore com estado correto ----
      if (cid && userDocId && !resultado.shouldCreateOrder) {
        await salvarMensagem(
          cid, userDocId, "assistant", cleanTextFormatado,
          flowStateAntes, wFlowState,
          tagsDetectadas, produtosCardIds, null
        );
        await atualizarConversa(userDocId, cid, {
          flowStateAtual:       wFlowState,
          carrinhoFinal:        wCart,
          customerDataColetado: wCustomerData,
        });
      }
    } catch (e) {
      console.error("Erro ao chamar agente:", e);
      setMensagens((prev) => [
        ...prev,
        {
          id:        `err-${Date.now()}`,
          role:      "assistant",
          content:   "Ops! Tive um problema técnico. Tente novamente. 🙏",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setEnviando(false);
      inputRef.current?.focus();
    }
  };

  // -------- Helpers --------
  const totalCarrinho = carrinho.reduce((s, i) => s + i.price * i.quantity, 0);
  const qtdItens      = carrinho.reduce((s, i) => s + i.quantity, 0);
  const formatarHora  = (d: Date) =>
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  // -------- Adicionar produto silenciosamente (sem mensagem, só atualiza carrinho) --------
  const adicionarSilencioso = (produto: Produto) => {
    const emCarrinho = carrinho.find(i => i.id === produto.id);
    const novaQtd = (emCarrinho?.quantity ?? 0) + 1;
    const novoCart = emCarrinho
      ? carrinho.map(i => i.id === produto.id ? { ...i, quantity: novaQtd } : i)
      : [...carrinho, { ...produto, quantity: 1 }];
    setCarrinho(novoCart);
    if (userDocId) {
      sincronizarItemCarrinho(userDocId, { ...produto, quantity: novaQtd }).catch(console.error);
    }
  };

  const progressoCheckout =
    flowState === FLOW_STATES.BROWSING
      ? 0
      : ((CHECKOUT_SEQUENCE.indexOf(flowState) + 1) / CHECKOUT_SEQUENCE.length) * 100;

  // ID da última mensagem do agente (para mostrar chips de seleção)
  const ultimaMsgAssistenteId = mensagens.reduce((lastId, msg) => {
    if (msg.role === 'assistant') return msg.id;
    return lastId;
  }, '');

  // Chips de pagamento com ícones (mostrados como cards de ícone)
  const PAYMENT_CHIPS: { label: string; shortLabel: string; Icon: React.ElementType; color: string }[] = [
    { label: 'Pix',           shortLabel: 'Pix',     Icon: QrCode,     color: '#00897B' },
    { label: 'Dinheiro',      shortLabel: 'Dinheiro', Icon: Banknote,   color: '#388E3C' },
    { label: 'Cartão Crédito', shortLabel: 'Crédito', Icon: CreditCard, color: '#1976D2' },
    { label: 'Cartão Débito',  shortLabel: 'Débito',  Icon: CreditCard, color: '#F57C00' },
  ];

  // Chips de seleção rápida por estado do fluxo
  const getQuickReplies = (fs: FlowState, carrinhoLen: number): string[] => {
    switch (fs) {
      case FLOW_STATES.BROWSING:
        return carrinhoLen > 0 ? ['Finalizar pedido 🛒', 'Continuar comprando'] : [];
      case FLOW_STATES.CHECKING_SAVED_ADDRESS:
        return ['Usar endereço salvo', 'Informar novo endereço'];
      case FLOW_STATES.ASKING_SAVE_ADDRESS:
        return ['Sim, salvar endereço', 'Não salvar'];
      case FLOW_STATES.COLLECTING_PAYMENT:
        return []; // tratado separadamente com ícones
      case FLOW_STATES.COLLECTING_CARD_BRAND:
        return ['Visa', 'Mastercard', 'Elo', 'American Express'];
      case FLOW_STATES.COLLECTING_CPF:
        return ['Não'];
      case FLOW_STATES.CONFIRMING_ORDER:
        return ['✅ Confirmar pedido', '❌ Cancelar'];
      default:
        return [];
    }
  };
  const quickReplies = getQuickReplies(flowState, carrinho.length);
  const saudacaoInicialCarregada = mensagens.some((m) => m.id === "welcome");

  const handleAdicionarQtdCarrinho = (item: CartItem) => {
    const novaQtd = item.quantity + 1;
    setCarrinho(prev => prev.map(i => i.id === item.id ? { ...i, quantity: novaQtd } : i));
    if (userDocId) {
      sincronizarItemCarrinho(userDocId, { ...item, quantity: novaQtd }).catch(console.error);
    }
  };

  const handleRemoverQtdCarrinho = (item: CartItem) => {
    if (item.quantity <= 1) {
      setCarrinho(prev => prev.filter(i => i.id !== item.id));
      if (userDocId) removerItemCarrinhoFirestore(userDocId, item.id).catch(console.error);
    } else {
      const novaQtd = item.quantity - 1;
      setCarrinho(prev => prev.map(i => i.id === item.id ? { ...i, quantity: novaQtd } : i));
      if (userDocId) sincronizarItemCarrinho(userDocId, { ...item, quantity: novaQtd }).catch(console.error);
    }
  };

  const handleRemoverItemCompleto = (itemId: string) => {
    setCarrinho(prev => prev.filter(i => i.id !== itemId));
    if (userDocId) removerItemCarrinhoFirestore(userDocId, itemId).catch(console.error);
  };

  const formatarPrecoCarrinho = (preco: number) =>
    preco.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // -------- Sincronizar diff de carrinho (nível de componente) --------
  const sincronizarDiffCarrinho = (cartAntes: CartItem[], cartDepois: CartItem[]) => {
    if (!userDocId) return;
    for (const novoItem of cartDepois) {
      const itemAnterior = cartAntes.find(i => i.id === novoItem.id);
      if (!itemAnterior || itemAnterior.quantity !== novoItem.quantity) {
        sincronizarItemCarrinho(userDocId, novoItem).catch(console.error);
      }
    }
    for (const itemAnterior of cartAntes) {
      if (!cartDepois.find(i => i.id === itemAnterior.id)) {
        removerItemCarrinhoFirestore(userDocId, itemAnterior.id).catch(console.error);
      }
    }
  };

  // -------- Salvar resposta do agente (nível de componente, fora do enviarMensagem) --------
  const salvarRespostaAgente = async (content: string, produtosCard?: Produto[], suggestions?: string[]) => {
    const contentFormatado = limparMarkdownBasico(content);
    setMensagens(prev => [...prev, {
      id: `assistant-local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: "assistant" as const,
      content: contentFormatado,
      timestamp: new Date(),
      produtosCard: produtosCard?.length ? produtosCard : undefined,
      suggestions: suggestions?.length ? suggestions : undefined,
    }]);
    if (conversaId && userDocId) {
      await salvarMensagem(conversaId, userDocId, "assistant", contentFormatado, flowState, flowState, [], (produtosCard ?? []).map(p => p.id), null);
      await atualizarConversa(userDocId, conversaId, { flowStateAtual: flowState, carrinhoFinal: carrinho, customerDataColetado: customerData });
    }
  };

  // -------- Selecionar variante via clique no + do card (sem enviar mensagem) --------
  const selecionarVarianteCard = async (produto: Produto) => {
    // Item único com quantidade
    if (itemUnicoQtdState && (itemUnicoQtdState.stage === "choose_other" || itemUnicoQtdState.stage === "confirm_single")) {
      const qtd = itemUnicoQtdState.quantidade;
      const cartAntes = [...carrinho];
      const novoCart = adicionarItemAoCarrinhoFn(cartAntes, produto, qtd);
      setCarrinho(novoCart);
      sincronizarDiffCarrinho(cartAntes, novoCart);
      setItemUnicoQtdState(null);
      await salvarRespostaAgente(
        `Adicionei ${qtd}x ${produto.name} ao carrinho! 🛒`,
        [produto],
        ["Finalizar pedido 🛒"]
      );
      return;
    }

    // Lista de pedido em seleção de variante
    if (listaPedidoState && listaPedidoState.stage === "selecting_variant") {
      const estado: ListaPedidoState = { ...listaPedidoState, itens: listaPedidoState.itens.map(it => ({ ...it })) };
      const idx = estado.currentIndex;
      const itemAtual = estado.itens[idx];
      if (!itemAtual) { adicionarSilencioso(produto); return; }

      const cartAntes = [...carrinho];
      const novoCart = adicionarItemAoCarrinhoFn(cartAntes, produto, itemAtual.quantidade);
      setCarrinho(novoCart);
      sincronizarDiffCarrinho(cartAntes, novoCart);
      itemAtual.selecionadoId = produto.id;

      const prox = proximoIndicePendenteFn(estado.itens, idx);
      if (prox === -1) {
        setListaPedidoState(null);
        const cardsFinal = estado.itens
          .map(it => it.candidatos.find(c => c.id === it.selecionadoId))
          .filter((p): p is Produto => Boolean(p))
          .slice(0, 6);
        await salvarRespostaAgente(
          `Todos os itens adicionados!\n\n${formatarResumoCarrinho(novoCart)}`,
          cardsFinal,
          ["Finalizar pedido 🛒"]
        );
      } else {
        estado.currentIndex = prox;
        estado.stage = "selecting_variant";
        setListaPedidoState(estado);
        const itemProx = estado.itens[prox];
        if (itemProx.candidatos.length === 0) {
          estado.stage = "await_next_item";
          setListaPedidoState(estado);
          await salvarRespostaAgente(
            `Item ${prox + 1}/${estado.itens.length}: ${itemProx.quantidade}x ${itemProx.termoBusca}\nNão encontrei variedades disponíveis. Deseja ir para o próximo ou cancelar?`,
            undefined,
            ["Próximo item", "Cancelar lista"]
          );
        } else {
          const opcoes = itemProx.candidatos.slice(0, 5);
          const sufixo = estado.itens.length > 1 ? ` (item ${prox + 1} de ${estado.itens.length})` : "";
          await salvarRespostaAgente(
            `Estas são as opções de ${itemProx.termoBusca} que temos hoje${sufixo}. Para adicionar no pedido é só clicar no "+" ao lado do produto.`,
            opcoes,
            ["Cancelar item"]
          );
        }
      }
      return;
    }

    // Fora de contexto de seleção: incrementa silenciosamente
    adicionarSilencioso(produto);
  };

  // ============================================================
  // ESTADOS DE CARREGAMENTO / SEM LOGIN
  // ============================================================
  if (authLoading || carregandoConversa || (user !== null && !saudacaoInicialCarregada)) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingContainer}>
          <Loader2 size={40} className={styles.spinnerIcon} />
          <p className={styles.loadingText}>
            {carregandoConversa ? "Carregando conversa..." : "Carregando assistente..."}
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <UserCircle size={64} color="#ccc" strokeWidth={1.2} />
          <p className={styles.emptyText}>
            Faça login para falar com nosso assistente de vendas
          </p>
          <button
            className={styles.loginButton}
            onClick={() => (window.location.href = "/Login")}
          >
            Fazer Login
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className={styles.container}>
      <Header />

      {/* Barra de progresso do checkout */}
      {flowState !== FLOW_STATES.BROWSING && (
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${progressoCheckout}%` }}
          />
        </div>
      )}

      {/* Backdrop do carrinho */}
      {mostrarCarrinho && (
        <div className={styles.agCarrinhoBackdrop} onClick={() => setMostrarCarrinho(false)} />
      )}

      {/* Sidebar do carrinho */}
      <div className={`${styles.agCarrinhoSidebar} ${mostrarCarrinho ? styles.agCarrinhoSidebarOpen : ''}`}>
        <button className={styles.agCarrinhoSidebarClose} onClick={() => setMostrarCarrinho(false)}>
          <X size={22} />
        </button>

        <div className={styles.agCarrinhoInner}>
          {/* Contador de itens */}
          <div className={styles.agQuantCarrinho}>
            <p className={styles.agQuantContent}>
              <span className={styles.agTotalItens}>{qtdItens}</span>
              {qtdItens === 1 ? "Item no carrinho" : "Itens no carrinho"}
            </p>
          </div>

          {/* Lista de produtos */}
          <div className={styles.agProdutosCarrinho}>
            {carrinho.length === 0 ? (
              <div className={styles.agCarrinhoVazio}>
                <p>Seu carrinho está vazio</p>
              </div>
            ) : (
              carrinho.map((item) => (
                <div key={item.id} className={styles.agProdutoContainer}>
                  <div className={styles.agImageContainer}>
                    <Image
                      className={styles.agProdutoImage}
                      src={item.image || "/prodSemImg.svg"}
                      fill
                      alt={item.name}
                      sizes="80px"
                      onError={(e) => { (e.target as HTMLImageElement).src = '/prodSemImg.svg'; }}
                    />
                  </div>
                  <div className={styles.agProdutoContent}>
                    <div className={styles.agProdutoInfo}>
                      <p className={styles.agProdutoNome}>{item.name}</p>
                      <span className={styles.agProdutoPrice}>
                        R$ {formatarPrecoCarrinho(item.price)}
                      </span>
                    </div>
                    <div className={styles.agProdutoActions}>
                      <button
                        className={styles.agRemoveBtn}
                        onClick={() => handleRemoverItemCompleto(item.id)}
                      >
                        remover
                      </button>
                      <div className={styles.agQuantityBtn}>
                        <div className={styles.agQuantityBtnContainer}>
                          <button
                            className={styles.agRemoveQtyBtn}
                            onClick={() => handleRemoverQtdCarrinho(item)}
                          >
                            <Minus size={16} />
                          </button>
                          <span className={styles.agProdutoQuantidade}>{item.quantity}</span>
                          <button
                            className={styles.agAddQtyBtn}
                            onClick={() => handleAdicionarQtdCarrinho(item)}
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Valores e finalizar */}
          {carrinho.length > 0 && (
            <div className={styles.agValoresCarrinho}>
              <dl className={styles.agValores}>
                <div className={styles.agValoresContainer}>
                  <dt className={styles.agSubtotal}>
                    <p>Subtotal</p>
                    <span style={{ color: "green" }}>R$ {formatarPrecoCarrinho(totalCarrinho)}</span>
                  </dt>
                  <dt className={styles.agTaxaEntrega}>
                    <p>Taxa de entrega</p>
                    <span style={{ color: "green" }}>R$ {formatarPrecoCarrinho(DELIVERY_PRICE)}</span>
                  </dt>
                </div>
                <div className={styles.agFinalizar}>
                  <button
                    className={styles.agFinalizarBtn}
                    onClick={() => {
                      setMostrarCarrinho(false);
                      enviarMensagem("Finalizar pedido 🛒");
                    }}
                  >
                    <p>Finalizar carrinho</p>
                    <span>R$ {formatarPrecoCarrinho(totalCarrinho + DELIVERY_PRICE)}</span>
                  </button>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>

      {/* Mensagens */}
      <div className={styles.messagesContainer}>
        {mensagens.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.messageWrapper} ${
              msg.role === "user"
                ? styles.messageWrapperUser
                : styles.messageWrapperAgent
            }`}
          >
            {msg.role === "assistant" && (
              <div className={styles.agentAvatarSmall}>
                <Image src="/logo2.jpeg" alt="Assistente" fill className={styles.agentAvatarImg} sizes="28px" />
              </div>
            )}

            <div className={styles.messageColumn}>
              {/* Texto da mensagem */}
              <div
                className={`${styles.messageBubble} ${
                  msg.role === "user" ? styles.bubbleUser : styles.bubbleAgent
                }`}
              >
                {msg.content.split("\n").map((linha, i, arr) => (
                  <React.Fragment key={i}>
                    {linha}
                    {i < arr.length - 1 && <br />}
                  </React.Fragment>
                ))}
                <span className={styles.timestamp}>{formatarHora(msg.timestamp)}</span>
              </div>

              {/* Cards de produto */}
              {msg.produtosCard && msg.produtosCard.length > 0 && (
                <div className={styles.produtosCardWrapper}>
                  {msg.produtosCard.map((produto) => {
                    const emCarrinho = carrinho.find(i => i.id === produto.id);
                    return (
                      <div key={produto.id} className={styles.produtoCardRow}>
                        <div className={styles.produtoCard}>
                          <div
                            className={styles.produtoCardImgWrapper}
                            onClick={() =>
                              produto.image &&
                              setImagemAmpliada({ src: produto.image, name: produto.name, price: produto.price })
                            }
                            title={produto.image ? "Clique para ampliar" : undefined}
                          >
                            {produto.image ? (
                              <>
                                <Image
                                  src={produto.image}
                                  alt={produto.name}
                                  fill
                                  className={styles.produtoCardImg}
                                  sizes="96px"
                                  onError={(e) => { (e.target as HTMLImageElement).src = '/prodSemImg.svg'; }}
                                />
                                <ZoomIn
                                  size={14}
                                  style={{
                                    position: "absolute",
                                    bottom: 4,
                                    right: 4,
                                    color: "#fff",
                                    filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))",
                                    pointerEvents: "none",
                                  }}
                                />
                              </>
                            ) : (
                              <Image
                                src="/prodSemImg.svg"
                                alt={produto.name}
                                fill
                                className={styles.produtoCardImg}
                                sizes="96px"
                              />
                            )}
                          </div>
                          <div className={styles.produtoCardInfo}>
                            <p className={styles.produtoCardName}>{produto.name}</p>
                            <p className={styles.produtoCardPrice}>
                              R$ {produto.price.toFixed(2)}
                            </p>
                          </div>
                        </div>
                        {/* Botão separado ao lado do card */}
                        {flowState === FLOW_STATES.BROWSING && (
                          <button
                            className={`${styles.produtoCardAddBtn} ${emCarrinho ? styles.produtoCardAddBtnMore : ''}`}
                            onClick={() => {
                              const emSelecao =
                                (itemUnicoQtdState && (itemUnicoQtdState.stage === "choose_other" || itemUnicoQtdState.stage === "confirm_single")) ||
                                (listaPedidoState && listaPedidoState.stage === "selecting_variant");
                              if (emSelecao && !emCarrinho) {
                                selecionarVarianteCard(produto);
                              } else {
                                adicionarSilencioso(produto);
                              }
                            }}
                            title={emCarrinho ? `Mais 1 ${produto.name}` : `Adicionar ${produto.name}`}
                          >
                            {emCarrinho ? `+${emCarrinho.quantity}` : '+'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Chips de recuperação de carrinho */}
              {msg.id === "cart-recovery" && cartRecoveryPending && !enviando && (
                <div className={styles.selectionChips}>
                  <button
                    className={styles.selectionChip}
                    onClick={() => {
                      setCartRecoveryPending(false);
                      setMensagens((prev) => [
                        ...prev.filter((m) => m.id !== "cart-recovery"),
                        {
                          id:        "cart-recovery-done",
                          role:      "assistant",
                          content:   "Ótimo! Continuando sua compra anterior. 🛒\n\nO que mais gostaria de adicionar ou prefere finalizar o pedido?",
                          timestamp: new Date(),
                        },
                      ]);
                    }}
                  >
                    Continuar compra 🛒
                  </button>
                  <button
                    className={`${styles.selectionChip} ${styles.selectionChipDanger}`}
                    onClick={() => {
                      setCartRecoveryPending(false);
                      limparConversa();
                    }}
                  >
                    Esvaziar e começar nova
                  </button>
                </div>
              )}

              {/* Chips de sugestão do agente [SUGGEST:...] */}
              {msg.suggestions && msg.suggestions.length > 0 && msg.id === ultimaMsgAssistenteId && !enviando && (
                <div className={styles.selectionChips}>
                  {msg.suggestions.map((s) => (
                    <button
                      key={s}
                      className={styles.selectionChip}
                      onClick={() => enviarMensagem(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Chips de seleção rápida — apenas na última mensagem do agente */}
              {msg.id === ultimaMsgAssistenteId && !enviando && !cartRecoveryPending && (
                <>
                  {/* Chips de pagamento com ícone */}
                  {flowState === FLOW_STATES.COLLECTING_PAYMENT && (
                    <div className={styles.paymentChips}>
                      {PAYMENT_CHIPS.map(({ label, shortLabel, Icon, color }) => (
                        <button
                          key={label}
                          className={styles.paymentChip}
                          onClick={() => enviarMensagem(label)}
                          title={label}
                        >
                          <Icon size={26} color={color} strokeWidth={1.8} />
                          <span className={styles.paymentChipLabel}>{shortLabel}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Chips de texto para outros estados */}
                  {quickReplies.length > 0 && (!msg.suggestions || msg.suggestions.length === 0) && (
                    <div className={styles.selectionChips}>
                      {quickReplies.map((label) => (
                        <button
                          key={label}
                          className={styles.selectionChip}
                          onClick={() => enviarMensagem(label)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {msg.role === "user" && user?.photoURL && (
              <Image
                src={user.photoURL}
                alt="Você"
                width={28}
                height={28}
                className={styles.userAvatar}
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        ))}

        {/* Indicador de digitação */}
        {enviando && (
          <div className={`${styles.messageWrapper} ${styles.messageWrapperAgent}`}>
            <div className={styles.agentAvatarSmall}>
              <Image src="/logo2.jpeg" alt="Assistente" fill className={styles.agentAvatarImg} sizes="28px" />
            </div>
            <div className={`${styles.messageBubble} ${styles.bubbleAgent} ${styles.typingBubble}`}>
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Lightbox */}
      {imagemAmpliada && (
        <div
          className={styles.lightboxOverlay}
          onClick={() => setImagemAmpliada(null)}
        >
          <div
            className={styles.lightboxContent}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className={styles.lightboxCloseBtn}
              onClick={() => setImagemAmpliada(null)}
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
            <div className={styles.lightboxImgWrapper}>
              <Image
                src={imagemAmpliada.src}
                alt={imagemAmpliada.name}
                fill
                className={styles.lightboxImg}
                sizes="400px"
              />
            </div>
            <p className={styles.lightboxName}>{imagemAmpliada.name}</p>
            <p className={styles.lightboxPrice}>R$ {imagemAmpliada.price.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Tour onboarding */}
      {tourEtapa !== null && (
        <div className={styles.tourOverlay}>
          <div className={styles.tourCard}>
            <span className={styles.tourEmoji}>{TOUR_STEPS[tourEtapa].emoji}</span>
            <h3 className={styles.tourTitulo}>{TOUR_STEPS[tourEtapa].titulo}</h3>
            <p className={styles.tourDesc}>{TOUR_STEPS[tourEtapa].desc}</p>

            <div className={styles.tourDots}>
              {TOUR_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`${styles.tourDot} ${i === tourEtapa ? styles.tourDotAtivo : ""}`}
                />
              ))}
            </div>

            <div className={styles.tourActions}>
              <button className={styles.tourSkipBtn} onClick={fecharTour}>
                Pular
              </button>
              <button className={styles.tourBtn} onClick={proximaTour}>
                {tourEtapa < TOUR_STEPS.length - 1 ? "Próximo →" : "Entendi! 🎉"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Botão flutuante arrastável do carrinho */}
      <button
        className={styles.floatingCartBtn}
        style={btnCartPos ? { left: btnCartPos.x, top: btnCartPos.y, bottom: "auto", right: "auto" } : {}}
        onMouseDown={(e) => {
          isDraggingCartRef.current = true;
          dragMovedCartRef.current  = false;
          dragOffsetCartRef.current = {
            x: e.clientX - (btnCartPos?.x ?? window.innerWidth - 80),
            y: e.clientY - (btnCartPos?.y ?? window.innerHeight - 150),
          };
          e.preventDefault();
        }}
        onTouchStart={(e) => {
          isDraggingCartRef.current = true;
          dragMovedCartRef.current  = false;
          dragOffsetCartRef.current = {
            x: e.touches[0].clientX - (btnCartPos?.x ?? window.innerWidth - 80),
            y: e.touches[0].clientY - (btnCartPos?.y ?? window.innerHeight - 150),
          };
          e.preventDefault();
        }}
        onClick={() => {
          if (!dragMovedCartRef.current) setMostrarCarrinho((v) => !v);
          dragMovedCartRef.current = false;
        }}
        aria-label="Ver carrinho"
      >
        <ShoppingCart size={24} />
        {qtdItens > 0 && (
          <span className={styles.floatingCartBadge}>{qtdItens}</span>
        )}
      </button>

      {/* Input */}
      <div className={styles.inputContainer}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Digite sua mensagem..."
          className={styles.messageInput}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && enviarMensagem()}
          disabled={enviando}
        />
        <button
          className={styles.sendButton}
          onClick={() => enviarMensagem()}
          disabled={!inputText.trim() || enviando}
          aria-label="Enviar mensagem"
        >
          {enviando ? (
            <Loader2 size={20} className={styles.spinnerIcon} />
          ) : (
            <Send size={20} />
          )}
        </button>
      </div>
    </div>
  );
};

export default AgentePage;
