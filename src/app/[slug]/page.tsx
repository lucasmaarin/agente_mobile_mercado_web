/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { onAuthStateChanged, signInAnonymously, signOut, signInWithPhoneNumber, RecaptchaVerifier, ConfirmationResult, setPersistence, browserLocalPersistence, browserSessionPersistence, User } from "firebase/auth";
import { collection, query, where, getDocs } from "firebase/firestore";
import { Send, Loader2, ShoppingCart, X, ZoomIn, QrCode, Banknote, CreditCard, Plus, Minus, Mic } from "lucide-react";
import Image from "next/image";
import styles from "../Agente/Agente.module.css";
import { auth, db } from "@/lib/firebase";
import Header from "@/components/Header/Header";
import WelcomeCard from "@/components/Chat/WelcomeCard";
import InfoBar from "@/components/Chat/InfoBar";
import AuthCheckboxCard from "@/components/Chat/AuthCheckboxCard";
import CheckoutModal from "@/components/CheckoutModal/CheckoutModal";
import { validatePhone } from "@/lib/validation";
import { useEstabelecimento } from "@/hooks/useEstabelecimento";
import {
  normalizar,
  filtrarProdutos,
  filtrarProdutosWordKeys,
  selecionarCardsPorTermos,
  combinarProdutosFoco,
  buscarAlternativasPorTermo,
  buildIndiceCategoria,
  detectarContexto,
  detectarNomeContexto,
  extrairPalavrasBaseBusca,
  traduzirAbreviacoes,
  sugerirCorrecaoOrtografica,
} from "@/lib/productSearch";
import {
  limparMarkdownBasico,
  ehSaudacaoCurta,
  ehIntencaoSemProduto,
  ehIntencaoCheckout,
  ehAcaoContinuarComprando,
  ehAcaoAlterarItem,
  ehConfirmacaoPositiva,
  ehCancelamento,
  ehEscolhaAutomatica,
  ehEscolhaVariacao,
  encontrarIndiceEscolhido,
  extrairItensListaComQuantidade,
  extrairItensSimples,
  formatarResumoCarrinho,
  adicionarItemAoCarrinhoFn,
  proximoIndicePendenteFn,
  montarNomeCompletoUsuario,
  NUMERO_POR_TEXTO,
} from "@/lib/chatUtils";

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
import { SLUG_PARA_COMPANY_ID } from "@/config/dominios";
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
  criarUsuarioNovo,
  atualizarNomeUsuario,
  atualizarDadosUsuario,
  ExemploConversa,
  DELIVERY_PRICE,
  buscarPedidosDoUsuario,
  Pedido,
} from "@/services/firestore";
import { Timestamp } from "firebase/firestore";


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


// ============================================================
// TIPOS
// ============================================================
interface Mensagem {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  produtosCard?: Produto[]; // cards de produto exibidos junto à mensagem
  termoBusca?: string;      // termo usado para buscar esses produtos (para "ver todos")
  suggestions?: string[];   // chips clicáveis gerados pelo [SUGGEST:...] do agente
  authCheckboxCard?: boolean; // card especial com checkboxes de login
  isWelcomeCard?: boolean;    // card de apresentação inicial estilizado
  skeletonCardCount?: number; // quantidade de skeleton cards durante streaming
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
  collecting_name:          "Nome",
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
  collecting_cpf:                "CPF",
  collecting_cpf_onboarding:     "CPF (cadastro)",
  confirming_order:              "Confirmando pedido",
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
  const params = useParams();
  const rawSlug = params.slug as string;
  const companyId = SLUG_PARA_COMPANY_ID[rawSlug.toLowerCase()] ?? rawSlug;

  // --- Auth
  const [user, setUser]           = useState<User | null>(null);
  const [userDocId, setUserDocId] = useState<string | null>(null);
  const [nomeCliente, setNomeCliente] = useState("Cliente");
  const [userCpf, setUserCpf]     = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  // --- Fluxo de autenticação por telefone (inline no chat) ---
  const [authStep, setAuthStep]               = useState<'phone' | 'validating' | 'code_modal'>('phone');
  const [authPhone, setAuthPhone]             = useState('');
  const [authCode, setAuthCode]               = useState('');
  const [authConfirmation, setAuthConfirmation] = useState<ConfirmationResult | null>(null);
  const [authKeepLogged, setAuthKeepLogged]   = useState(true);
  const [authAcceptTerms, setAuthAcceptTerms] = useState(false);
  const [authPhoneError, setAuthPhoneError]   = useState('');
  const [authCodeError, setAuthCodeError]     = useState('');
  const [authSending, setAuthSending]         = useState(false);
  const [loginCompleto, setLoginCompleto]     = useState(false);
  const [authDigitando, setAuthDigitando]     = useState(false);
  const recaptchaAuthRef = useRef<RecaptchaVerifier | undefined>(undefined);
  const authIniciado = useRef(false); // garante que mensagens de auth só são adicionadas uma vez

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

  // --- Estabelecimento (via hook)
  const {
    logoEstabelecimento,
    nomeEstabelecimento,
    nomeEstabelecimentoCarregado,
    infoEstabelecimento,
    formasPagamento,
    lojaConfig,
  } = useEstabelecimento(companyId);

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
  const [showCheckout, setShowCheckout]         = useState(false);
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
  const [headerOffset, setHeaderOffset] = useState(136);

  // --- Histórico de pedidos do usuário
  const [pedidosCached, setPedidosCached] = useState<Pedido[]>([]);
  const [pedidosPage, setPedidosPage] = useState(0);

  // --- Tour onboarding
  const [tourEtapa, setTourEtapa]     = useState<number | null>(null);
  const [tourIniciado, setTourIniciado] = useState(false);

  // --- Voz
  const [gravando, setGravando]           = useState(false);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const [carouselEnabled, setCarouselEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('testConfig_carouselEnabled');
    return saved === null ? true : saved === 'true';
  });
  const [wordKeysEnabled, setWordKeysEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('testConfig_wordKeysEnabled');
    return saved === 'true';
  });

  const carouselDragRef   = useRef<{ el: HTMLDivElement; startX: number; scrollLeft: number; dragging: boolean } | null>(null);
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const audioChunksRef    = useRef<Blob[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);

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

  // -------- Registrar Service Worker --------
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // -------- Autenticação --------
  const isGuestMode = process.env.NEXT_PUBLIC_GUEST_MODE === 'true';

  useEffect(() => {
    if (isGuestMode) {
      // Login anônimo para ter token válido no Firestore
      signInAnonymously(auth).catch(console.error);
    }

    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      // Se não é guest mode e o usuário logado é anônimo, desloga para forçar autenticação real
      if (!isGuestMode && currentUser?.isAnonymous) {
        signOut(auth).catch(console.error);
        return;
      }
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
            if (isGuestMode) {
              setNomeCliente('Convidado');
            } else {
              const nome = montarNomeCompletoUsuario(data, currentUser);
              setNomeCliente(nome);
              setUserCpf(data?.cpf ?? '');
              setUserPhone(data?.telefone ?? currentUser.phoneNumber ?? '');
              if (!nome || nome === 'Cliente') {
                setFlowState(FLOW_STATES.COLLECTING_NAME);
              }
            }
          } else {
            const newDocId = await criarUsuarioNovo(currentUser.uid, currentUser.phoneNumber ?? undefined);
            setUserDocId(newDocId);
            if (!isGuestMode) {
              setFlowState(FLOW_STATES.COLLECTING_NAME);
            } else {
              setNomeCliente('Convidado');
            }
          }
        } catch (e) {
          console.error("Erro ao buscar usuário:", e);
        }
      }
      setAuthLoading(false);
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- Inicializa mensagens de auth no chat quando não há usuário logado --------
  useEffect(() => {
    if (authLoading) return;
    if (isGuestMode) return;
    const needsLogin = !user || user.isAnonymous;
    if (needsLogin && !authIniciado.current) {
      authIniciado.current = true;
      // Só inicializa se o chat estiver vazio — se já tiver mensagens (ex: após logout), não substitui
      setMensagens(prev => {
        if (prev.length > 0) return prev;
        return [
          { id: 'auth-0', role: 'assistant', content: 'Olá! 👋 Bem-vindo(a)!', timestamp: new Date() },
          { id: 'auth-1', role: 'assistant', content: 'Para continuar, preciso que você faça login. Informe seu número de telefone com DDD:', timestamp: new Date() },
        ];
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  // (logo, nome, info do estabelecimento agora via useEstabelecimento hook)

  // -------- Carregar produtos + exemplos ativos + endereço salvo --------
  useEffect(() => {
    if (!user || !userDocId) return;
    getProducts(companyId)
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
    if (!userDocId || !produtosCarregados || !nomeEstabelecimentoCarregado) return;

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
        setCarrinho([]);
        setCustomerData({});
        setCartRecoveryPending(false);
        // Não sobrescreve COLLECTING_NAME/CPF_ONBOARDING definidos no onAuthStateChanged
        const isNewUser = nomeCliente === 'Cliente' || !nomeCliente;
        if (!isNewUser) setFlowState(FLOW_STATES.BROWSING);
        const welcomeContent = isNewUser
          ? `Como você gostaria de ser chamado?`
          : `Como posso ajudar você hoje?`;
        const welcomeSuggestions = isNewUser ? undefined : ["🛒 Montar meu pedido", "🧺 Buscar produtos", "🧾 Ver pedidos"];
        // Preserva mensagens de auth anteriores e appenda a boas-vindas
        setMensagens(prev => {
          const authMsgs = prev.filter(m => m.id.startsWith('auth-') || m.id.startsWith('logout-'));
          return [...authMsgs, {
            id: 'welcome', role: 'assistant' as const,
            content: welcomeContent, isWelcomeCard: true, timestamp: new Date(),
            suggestions: welcomeSuggestions,
          }];
        });
      } catch (e) {
        console.error("Erro ao iniciar nova conversa:", e);
        setMensagens(prev => {
          const authMsgs = prev.filter(m => m.id.startsWith('auth-') || m.id.startsWith('logout-'));
          return [...authMsgs, {
            id: 'welcome', role: 'assistant' as const,
            content: 'Como posso ajudar você hoje?', isWelcomeCard: true, timestamp: new Date(),
            suggestions: ["🛒 Montar meu pedido", "🧺 Buscar produtos", "🧾 Ver pedidos"],
          }];
        });
      } finally {
        setCarregandoConversa(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDocId, produtosCarregados, nomeEstabelecimentoCarregado]);

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
      id:            "welcome",
      role:          "assistant",
      content:       "Como posso ajudar você hoje?",
      isWelcomeCard: true,
      timestamp:     new Date(),
      suggestions:   ["🛒 Montar meu pedido", "🧺 Buscar produtos", "🧾 Ver pedidos"],
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

  // -------- Voz --------
  const transcreverAudio = async (blob: Blob) => {
    setTranscrevendo(true);
    try {
      const file = new File([blob], 'audio.webm', { type: blob.type });
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const data = await res.json();
      if (data.text?.trim()) setInputText(data.text.trim());
    } catch (e) {
      console.error('Erro ao transcrever áudio:', e);
    } finally {
      setTranscrevendo(false);
    }
  };

  const iniciarGravacao = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        transcreverAudio(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setGravando(true);
    } catch (e) {
      console.error('Erro ao acessar microfone:', e);
    }
  };

  const pararGravacao = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setGravando(false);
  };

  // -------- Auth por telefone (inline no chat) --------
  const formatPhoneAuth = (value: string) => {
    const d = value.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  const setupRecaptchaAuth = (): RecaptchaVerifier => {
    if (window.recaptchaVerifier) return window.recaptchaVerifier;
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
      callback: () => {},
    });
    window.recaptchaVerifier = verifier;
    recaptchaAuthRef.current = verifier;
    return verifier;
  };

  const handleAuthSendCode = async () => {
    const formatted = validatePhone(authPhone);
    if (!formatted) {
      setMensagens(prev => [
        ...prev.filter(m => m.id !== 'auth-phone-error'),
        { id: 'auth-phone-error', role: 'assistant', content: 'Número inválido. Use o formato: (11) 99999-9999', timestamp: new Date() },
      ]);
      return;
    }
    setAuthSending(true);
    setAuthStep('validating');
    const ts = Date.now();
    // Adiciona bubble do usuário + "Enviando..."
    setMensagens(prev => [
      ...prev.filter(m => !['auth-phone-error', 'auth-validating', 'auth-phone-user'].includes(m.id)),
      { id: 'auth-phone-user', role: 'user', content: authPhone, timestamp: new Date() },
      { id: 'auth-validating', role: 'assistant', content: `Enviando SMS para ${authPhone}…`, timestamp: new Date() },
    ]);
    try {
      await setPersistence(auth, authKeepLogged ? browserLocalPersistence : browserSessionPersistence);
      const result = await signInWithPhoneNumber(auth, formatted, setupRecaptchaAuth());
      setAuthConfirmation(result);
      setMensagens(prev => [
        ...prev.filter(m => !['auth-validating', 'auth-code-sent', 'auth-code-card'].includes(m.id)),
        { id: `auth-code-sent-${ts}`, role: 'assistant', content: `Código enviado para ${authPhone}. Digite os 6 dígitos no campo abaixo:`, timestamp: new Date() },
        { id: 'auth-code-card', role: 'assistant', content: '', authCheckboxCard: true, timestamp: new Date() },
      ]);
      setAuthStep('code_modal');
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      console.error('[PhoneAuth] Erro ao enviar SMS:', err.code, err.message, e);
      const errMsgs: Record<string, string> = {
        'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
        'auth/invalid-phone-number': 'Número inválido. Confira o DDD e os dígitos.',
        'auth/quota-exceeded': 'Limite de SMS atingido. Tente mais tarde.',
        'auth/captcha-check-failed': 'Verificação de segurança falhou. Recarregue a página.',
        'auth/invalid-app-credential': 'Erro de configuração. Tente novamente.',
      };
      const msgErro = errMsgs[err.code ?? ''] ?? 'Não foi possível enviar o SMS. Tente novamente.';
      setMensagens(prev => [
        ...prev.filter(m => !['auth-validating', 'auth-phone-error'].includes(m.id)),
        { id: 'auth-phone-error', role: 'assistant', content: msgErro, timestamp: new Date() },
      ]);
      setAuthStep('phone');
      if (window.recaptchaVerifier) { window.recaptchaVerifier.clear(); window.recaptchaVerifier = undefined; }
      recaptchaAuthRef.current = undefined;
    } finally { setAuthSending(false); }
  };

  const handleAuthVerifyCode = async () => {
    if (!authConfirmation || authCode.length !== 6 || !authAcceptTerms) return;
    setAuthSending(true);
    setAuthCodeError('');
    try {
      await authConfirmation.confirm(authCode);
      setLoginCompleto(true); // Esconde auth imediatamente, antes do onAuthStateChanged disparar
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      console.error('[PhoneAuth] Erro ao verificar código:', err.code, err.message, e);
      const msgs: Record<string, string> = {
        'auth/invalid-verification-code': 'Código incorreto. Verifique o SMS.',
        'auth/code-expired': 'Código expirado. Clique em reenviar.',
        'auth/session-expired': 'Sessão expirada. Solicite um novo código.',
      };
      setMensagens(prev => [
        ...prev.filter(m => m.id !== 'auth-code-error'),
        { id: 'auth-code-error', role: 'assistant', content: msgs[err.code ?? ''] ?? 'Não foi possível verificar. Tente novamente.', timestamp: new Date() },
      ]);
    } finally { setAuthSending(false); }
  };

  const handleAuthResend = () => {
    setAuthCode('');
    setAuthStep('phone');
    setAuthConfirmation(null);
    recaptchaAuthRef.current?.clear();
    recaptchaAuthRef.current = undefined;
    // Volta para o estado de digitar telefone, removendo os cards de código
    setMensagens(prev => prev.filter(m => !['auth-code-sent', 'auth-code-card', 'auth-code-error', 'auth-validating'].includes(m.id)));
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

      // Salvar mensagem do usuário (não-fatal)
      if (cid && userDocId) {
        salvarMensagem(
          cid, userDocId, 'user', texto,
          flowStateAntes, wFlowState, [], [], null
        ).catch(console.error);
      }

      const salvarRespostaLocal = async (
        content: string,
        produtosCard?: Produto[],
        suggestions?: string[],
        termoBusca?: string
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
            termoBusca: produtosCard && produtosCard.length > 0 ? termoBusca : undefined,
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
            sincronizarItemCarrinho(companyId, userDocId, novoItem).catch(console.error);
          }
        }
        for (const itemAnterior of cartAntes) {
          if (!cartDepois.find(i => i.id === itemAnterior.id)) {
            removerItemCarrinhoFirestore(companyId, userDocId, itemAnterior.id).catch(console.error);
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
          texto: `Estas são as opções de ${item.termoBusca} que temos hoje${sufixoLista}. Para adicionar no pedido é só clicar no "+" ao lado do produto. ⬇️`,
          produtosCard: opcoes,
          suggestions: ["Cancelar item"],
        };
      };

      if (wFlowState === FLOW_STATES.BROWSING) {

        // ── Ações do menu inicial ──────────────────────────────────────────────

        if (texto.includes("Montar meu pedido")) {
          await salvarRespostaLocal(
            "Ótimo! Cole ou escreva sua lista — pode ser com quebra de linha:\n\n" +
            "2 leite integral\n1 arroz 5kg\n3 refrigerante\n\n" +
            "Ou separado por vírgula:\n" +
            "2 leite integral, 1 arroz 5kg, 3 refrigerante\n\n" +
            "Vou buscar cada item e mostrar as opções disponíveis. Pode enviar! 👇"
          );
          return;
        }

        if (texto.includes("Buscar produtos")) {
          await salvarRespostaLocal(
            "Para buscar um produto é simples: basta digitar o nome do que você quer!\n\n" +
            "Exemplos:\n• \"arroz\"\n• \"leite integral 1L\"\n• \"refrigerante Coca-Cola\"\n\n" +
            "Vou mostrar as opções disponíveis para você escolher. 😊"
          );
          return;
        }

        if (texto.includes("🧾 Ver pedidos") || texto === "Ver pedidos") {
          // Busca os pedidos do usuário (cache ou fresh)
          let pedidos = pedidosCached;
          if (pedidos.length === 0 && userDocId) {
            try {
              pedidos = await buscarPedidosDoUsuario(companyId, userDocId);
              setPedidosCached(pedidos);
            } catch {
              pedidos = [];
            }
          }
          setPedidosPage(0);
          const slice = pedidos.slice(0, 5);
          if (slice.length === 0) {
            await salvarRespostaLocal(
              "Você ainda não fez nenhum pedido por aqui. Que tal fazer o primeiro agora? 🛒",
              undefined,
              ["🛒 Montar meu pedido", "🧺 Buscar produtos"]
            );
          } else {
            const resumo = slice.map((p, i) => {
              const data = p.createdAt?.toDate?.()?.toLocaleDateString('pt-BR') ?? "—";
              return `${i + 1}. Pedido #${p.orderNumber} — R$ ${p.total.toFixed(2).replace('.', ',')} — ${data}`;
            }).join("\n");
            const temMais = pedidos.length > 5;
            await salvarRespostaLocal(
              `Aqui estão seus últimos pedidos:\n\n${resumo}`,
              undefined,
              temMais ? ["📄 Pedidos anteriores", "🛒 Fazer um novo pedido"] : ["🛒 Fazer um novo pedido"]
            );
          }
          return;
        }

        if (texto.includes("Pedidos anteriores")) {
          const novaPagina = pedidosPage + 1;
          const slice = pedidosCached.slice(novaPagina * 5, novaPagina * 5 + 5);
          if (slice.length === 0) {
            await salvarRespostaLocal("Esses são todos os seus pedidos.", undefined, ["🛒 Fazer um novo pedido"]);
          } else {
            setPedidosPage(novaPagina);
            const resumo = slice.map((p, i) => {
              const data = p.createdAt?.toDate?.()?.toLocaleDateString('pt-BR') ?? "—";
              return `${novaPagina * 5 + i + 1}. Pedido #${p.orderNumber} — R$ ${p.total.toFixed(2).replace('.', ',')} — ${data}`;
            }).join("\n");
            const temMais = pedidosCached.length > (novaPagina + 1) * 5;
            await salvarRespostaLocal(
              `Pedidos anteriores:\n\n${resumo}`,
              undefined,
              temMais ? ["📄 Pedidos anteriores", "🛒 Fazer um novo pedido"] : ["🛒 Fazer um novo pedido"]
            );
          }
          return;
        }

        if (texto.includes("Fazer um novo pedido")) {
          await salvarRespostaLocal(
            "Claro! Pode me dizer o que você precisa hoje — pode digitar os produtos ou colar sua lista de compras que eu organizo tudo para você. 🛒"
          );
          return;
        }

        // ── Fim das ações do menu inicial ─────────────────────────────────────

        const textoNormalizado = normalizar(texto);
        const itensComQtd   = extrairItensListaComQuantidade(texto);
        const itensSimples  = itensComQtd.length < 2 ? extrairItensSimples(texto) : [];
        let itensExtraidos  = itensComQtd.length >= 2 ? itensComQtd : itensSimples;

        // Listas só são criadas com separadores explícitos (vírgula ou " e ").
        // Espaço simples NÃO cria fileiras separadas — "caldo liquido em cubo" é uma busca única.

        // Se itensComQtd tem exatamente 1 item (ex: "um frango", "2 ovos"), usa diretamente como item único
        const itemUnicoExtraido = itensComQtd.length === 1 ? itensComQtd[0] : (itensExtraidos.length === 1 ? itensExtraidos[0] : null);
        const podeIniciarLista = !listaPedidoState && itensExtraidos.length >= 2;

        if (itemUnicoQtdState) {
          // Se o usuário pediu um produto diferente do estado atual, reseta e processa normalmente
          const termoDiferenteExplicito = itemUnicoExtraido &&
            normalizar(itemUnicoExtraido.termoBusca) !== normalizar(itemUnicoQtdState.termoBusca);
          // Também detecta busca por produto diferente sem quantificador explícito
          const novasBuscasDiferentes = !itemUnicoExtraido && (() => {
            const resultados = wordKeysEnabled ? filtrarProdutosWordKeys(texto, produtos) : filtrarProdutos(texto, produtos);
            if (resultados.length === 0) return false;
            const idsAtuais = new Set(itemUnicoQtdState.candidatos.map(p => p.id));
            return resultados.every(p => !idsAtuais.has(p.id));
          })();
          const termoDiferente = termoDiferenteExplicito || novasBuscasDiferentes;
          if (termoDiferente) {
            setItemUnicoQtdState(null);
            // Cai no fluxo normal abaixo (não retorna)
          } else {
          if (ehCancelamento(texto) || textoNormalizado.includes("cancelar")) {
            setItemUnicoQtdState(null);
            await salvarRespostaLocal("Tudo bem, selecao cancelada.");
            return;
          }

          if (ehAcaoContinuarComprando(texto)) {
            setItemUnicoQtdState(null);
            await salvarRespostaLocal("Com prazer! 😊 Me conta o que mais está precisando e eu encontro rapidinho!");
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
                ["Finalizar pedido 🛒", "Continuar comprando"]
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
                `Estas são as opções de ${itemUnicoQtdState.termoBusca} que temos hoje. Para adicionar no pedido é só clicar no "+" ao lado do produto. ⬇️`,
                novoEstado.candidatos,
                ["Finalizar pedido 🛒", "Continuar comprando"],
                itemUnicoQtdState.termoBusca
              );
              return;
            }

            await salvarRespostaLocal(
              `Esta é a opção de ${itemUnicoQtdState.termoBusca} que temos hoje. Para adicionar no pedido é só clicar no "+" ao lado do produto. ⬇️`,
              [itemUnicoQtdState.produtoSugerido],
              ["Finalizar pedido 🛒", "Continuar comprando"],
              itemUnicoQtdState.termoBusca
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
              ["Finalizar pedido 🛒", "Continuar comprando"]
            );
            return;
          }

          // Verifica se o usuário está buscando um produto diferente (sem resultado no catálogo)
          const naoMencionaTermoAtual = !textoNormalizado.includes(normalizar(itemUnicoQtdState.termoBusca));
          const pareceBuscaNovaProduto = naoMencionaTermoAtual &&
            !ehConfirmacaoPositiva(texto) &&
            !ehCancelamento(texto) &&
            textoNormalizado.split(/\s+/).filter(w => w.length >= 3).length >= 2;
          if (pareceBuscaNovaProduto) {
            setItemUnicoQtdState(null);
            // Cai no fluxo normal (LLM responde sobre o novo produto/termo)
          } else {
            await salvarRespostaLocal(
              `Estas são as opções de ${itemUnicoQtdState.termoBusca} que temos hoje. Para adicionar no pedido é só clicar no "+" ao lado do produto. ⬇️`,
              itemUnicoQtdState.candidatos.slice(0, 6),
              ["Finalizar pedido 🛒", "Continuar comprando"],
              itemUnicoQtdState.termoBusca
            );
            return;
          }
          } // fecha else (termo diferente)
        }

        if (!listaPedidoState && itemUnicoExtraido) {
          const buscarLocal = (t: string) => wordKeysEnabled ? filtrarProdutosWordKeys(t, produtos) : filtrarProdutos(t, produtos);
          const candidatosItemUnico = buscarLocal(itemUnicoExtraido.termoBusca).slice(0, 6);
          if (candidatosItemUnico.length > 1) {
            const novoEstadoUnico: ItemUnicoQuantidadeState = {
              termoBusca: itemUnicoExtraido.termoBusca,
              quantidade: itemUnicoExtraido.quantidade,
              stage: "choose_other",
              candidatos: candidatosItemUnico,
            };
            setItemUnicoQtdState(novoEstadoUnico);
            await salvarRespostaLocal(
              `Estas são as opções de ${itemUnicoExtraido.termoBusca} que temos hoje. Para adicionar no pedido é só clicar no "+" ao lado do produto. ⬇️`,
              candidatosItemUnico,
              ["Finalizar pedido 🛒", "Continuar comprando"],
              itemUnicoExtraido.termoBusca
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
              `Esta é a opção de ${itemUnicoExtraido.termoBusca} que temos hoje. Para adicionar no pedido é só clicar no "+" ao lado do produto. ⬇️`,
              [sugerido],
              ["Finalizar pedido 🛒", "Continuar comprando"],
              itemUnicoExtraido.termoBusca
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
                  candidatos: (wordKeysEnabled ? filtrarProdutosWordKeys(it.termoBusca, produtos) : filtrarProdutos(it.termoBusca, produtos)).slice(0, 6),
                })),
              };

          if (!listaPedidoState) {
            // Um carrossel por item da lista — cada um como mensagem separada
            const sections = estadoAtual.itens
              .filter((it) => it.candidatos.length > 0)
              .map((it) => ({
                titulo: `Opções de ${it.termoBusca.charAt(0).toUpperCase() + it.termoBusca.slice(1)} ⬇️`,
                produtos: it.candidatos.slice(0, 6),
                termoBusca: it.termoBusca,
              }));
            const itensSemCandidatos = estadoAtual.itens.filter((it) => it.candidatos.length === 0);

            setListaPedidoState(estadoAtual);

            for (let i = 0; i < sections.length; i++) {
              const isLast = i === sections.length - 1 && itensSemCandidatos.length === 0;
              await salvarRespostaLocal(
                sections[i].titulo,
                sections[i].produtos,
                isLast ? ["Finalizar pedido 🛒", "Continuar comprando"] : undefined,
                sections[i].termoBusca
              );
            }
            if (itensSemCandidatos.length > 0) {
              const buscarL = (t: string) => wordKeysEnabled ? filtrarProdutosWordKeys(t, produtos) : filtrarProdutos(t, produtos);
              // Resolve cada item sem resultado: corrige ou informa
              type ItemResolvido = { texto: string; produtos?: Produto[]; termoBusca?: string };
              const resolvidos: ItemResolvido[] = [];
              for (const item of itensSemCandidatos) {
                const correcao = sugerirCorrecaoOrtografica(item.termoBusca, produtos);
                if (correcao) {
                  const candidatosCorrigidos = buscarL(correcao).slice(0, 6);
                  if (candidatosCorrigidos.length > 0) {
                    resolvidos.push({ texto: `Você quis dizer "${correcao}"? Aqui estão as opções ⬇️`, produtos: candidatosCorrigidos, termoBusca: correcao });
                    continue;
                  }
                }
                resolvidos.push({ texto: `Não encontrei "${item.termoBusca}" no catálogo.` });
              }
              // Chips apenas na última mensagem da sequência
              for (let r = 0; r < resolvidos.length; r++) {
                const isUltimo = r === resolvidos.length - 1;
                await salvarRespostaLocal(
                  resolvidos[r].texto,
                  resolvidos[r].produtos,
                  isUltimo ? ["Finalizar pedido 🛒", "Continuar comprando"] : undefined,
                  resolvidos[r].termoBusca
                );
              }
            }
            return;
          }

          if (estadoAtual.stage === "await_confirm") {
            // Finalizar pedido → abre checkout
            if (ehIntencaoCheckout(texto)) {
              setListaPedidoState(null);
              setShowCheckout(true);
              return;
            }
            // Continuar comprando → limpa lista e volta ao chat
            if (ehAcaoContinuarComprando(texto)) {
              setListaPedidoState(null);
              await salvarRespostaLocal("Tudo certo! O que mais posso separar para você? 😊");
              return;
            }
            if (ehCancelamento(texto)) {
              setListaPedidoState(null);
              await salvarRespostaLocal("Lista cancelada. Se quiser, envie novamente.");
              return;
            }
            // Se o cliente mandou um novo pedido, limpa o estado e processa normalmente
            setListaPedidoState(null);
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
                ["Finalizar pedido 🛒", "Continuar comprando"]
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
                ["Finalizar pedido 🛒", "Continuar comprando"]
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
                  ["Finalizar pedido 🛒", "Continuar comprando"]
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
      let contextoDetectado: string | undefined;
      if (wFlowState === FLOW_STATES.BROWSING) {
        const buscar = (t: string, cat: Produto[]) =>
          wordKeysEnabled ? filtrarProdutosWordKeys(t, cat) : filtrarProdutos(t, cat);

        // Contexto situacional tem prioridade sobre busca literal
        const termosContexto = detectarContexto(texto);
        const nomeContexto = detectarNomeContexto(texto);
        if (termosContexto.length > 0) {
          contextoDetectado = nomeContexto ?? undefined;
          const porContexto: Produto[] = [];
          const ids = new Set<string>();
          for (const termo of termosContexto) {
            for (const p of buscar(termo, produtos).slice(0, 4)) {
              if (!ids.has(p.id)) { ids.add(p.id); porContexto.push(p); }
            }
            if (porContexto.length >= 20) break;
          }
          if (porContexto.length > 0) {
            produtosFoco = porContexto.slice(0, 20);
            produtosMatchDireto = produtosFoco;
          }
          // Se contexto detectado mas sem produtos: produtosFoco fica vazio
          // → a IA pergunta o que o cliente precisa para aquela data
        } else {
          const filtrado = buscar(texto, produtos);
          produtosMatchDireto = filtrado;
          if (filtrado.length > 0) {
            // Mantém os matches no topo, mas adiciona diversidade para o agente
            produtosFoco = combinarProdutosFoco(filtrado.slice(0, 14), produtos, 20);
          } else {
            const palavrasLongas = normalizar(texto).split(/\s+/).filter(w => w.length >= 4);
            const pareceBuscaNova = palavrasLongas.length >= 2;
            if (!pareceBuscaNova && !ehSaudacaoCurta(texto)) {
              // Confirmação curta ("sim", "1", "pode"): reutiliza últimos produtos mostrados
              produtosFoco = ultimosProdutosMostradosRef.current;
            } else {
              // Sem contexto detectado: amostra por categoria para o agente ter IDs reais
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
      }

      // Few-shot
      const fewShot: FewShotExemplo[] = exemplosAtivos.map((ex) => ({
        mensagens: ex.mensagens.map((m) => ({ role: m.role, content: m.content })),
      }));

      // Prompt construído com o estado de trabalho atualizado
      const systemPrompt = buildSystemPrompt(
        produtosFoco,
        wFlowState === FLOW_STATES.BROWSING ? indiceCategoria : '',
        wCart,
        wFlowState,
        wCustomerData,
        nomeCliente,
        enderecoSalvo,
        lojaConfig?.taxaEntrega ?? DELIVERY_PRICE,
        fewShot,
        nomeEstabelecimento,
        formasPagamento,
        lojaConfig ?? undefined,
        contextoDetectado
      );

      // ---- Streaming ----
      const tempId = `agent-stream-${Date.now()}`;
      let rawText = "";
      let streamStarted = false;

      const chatRes = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: historico, systemPrompt }),
      });

      if (!chatRes.ok || !chatRes.body) {
        throw new Error(`Erro na API de chat: ${chatRes.status}`);
      }

      const reader  = chatRes.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const delta = decoder.decode(value, { stream: true });
        if (!delta) continue;
        rawText += delta;

        if (!streamStarted) {
          streamStarted = true;
          setMensagens(prev => [...prev, {
            id: tempId, role: "assistant" as const,
            content: "", timestamp: new Date(),
          }]);
        }

        const displayText = limparMarkdownBasico(rawText.replace(/\[[^\]]*(?:\]|$)/g, ""));
        const skeletonCount = (rawText.match(/\[SHOW:/g) ?? []).length;
        setMensagens(prev =>
          prev.map(m => m.id === tempId ? {
            ...m,
            content: displayText || "...",
            // só seta skeletonCardCount quando há SHOW tags — nunca seta 0 para não render "0"
            ...(skeletonCount > 0 ? { skeletonCardCount: skeletonCount } : {}),
          } : m)
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


      const termosBuscaUsuario = extrairPalavrasBaseBusca(texto);

      const produtosParaExibirBase = resultado.produtosParaMostrar;
      const produtosParaExibir = produtosParaExibirBase;

      if (produtosCardIds.length === 0 && produtosParaExibir.length > 0) {
        produtosCardIds = produtosParaExibir.map((p) => p.id);
      }

      // Salvar nome coletado no onboarding
      if (resultado.collectedName && userDocId) {
        setNomeCliente(resultado.collectedName);
        atualizarNomeUsuario(userDocId, resultado.collectedName).catch(() => {});
      }

      // Salvar CPF coletado no onboarding
      if (resultado.collectedCpf && resultado.collectedCpf !== 'skip' && userDocId) {
        setUserCpf(resultado.collectedCpf);
        atualizarDadosUsuario(userDocId, { cpf: resultado.collectedCpf }).catch(() => {});
      } else if (resultado.collectedCpf === 'skip') {
        // Usuário pulou CPF — vai para BROWSING mesmo assim (já tratado no parse)
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
            sincronizarItemCarrinho(companyId, userDocId, novoItem).catch(console.error);
          }
        }
        // Itens removidos
        for (const itemAnterior of cartAntes) {
          if (!resultado.newCart.find(i => i.id === itemAnterior.id)) {
            removerItemCarrinhoFirestore(companyId, userDocId, itemAnterior.id).catch(console.error);
          }
        }
      }

      // Calcular forcarPedido ANTES do setMensagens (precisa do ref antes de resetar)
      const forcarPedido = pendingOrderConfirmRef.current && !resultado.shouldCreateOrder;

      // Substituir mensagem temporária pela versão final com cards
      const cleanTextFormatado = limparMarkdownBasico(resultado.cleanText.replace(/\[[^\]]*\]/g, '').trim());
      const temCards = produtosParaExibir.length > 0;

      if (cleanTextFormatado || temCards) {
        setMensagens(prev =>
          prev.map(m =>
            m.id === tempId
              ? {
                  ...m,
                  content:           cleanTextFormatado,
                  produtosCard:      temCards ? produtosParaExibir : undefined,
                  skeletonCardCount: undefined, // limpa para não renderizar "0"
                  suggestions:       resultado.suggestions.length > 0
                    ? resultado.suggestions
                    : (temCards && wFlowState === FLOW_STATES.BROWSING
                        ? ["Finalizar pedido 🛒", "Continuar comprando"]
                        : undefined),
                }
              : m
          )
        );
      } else {
        // Sem texto e sem cards: remove o placeholder silenciosamente
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
          const orderResult = await createOrder(companyId, wCustomerData, wCart, userDocId, nomeCliente);

          // Subscrever notificações push para este cliente
          if ("serviceWorker" in navigator && "PushManager" in window) {
            try {
              const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
              if (vapidKey) {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: vapidKey,
                });
                await fetch("/api/push/inscrever", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId: userDocId, subscription: sub }),
                });
              }
            } catch {
              // Push não crítico — ignora silenciosamente
            }
          }

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
            limparCarrinhoFirestore(companyId, userDocId).catch(console.error);
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

      // ---- Salvar no Firestore com estado correto (não-fatal) ----
      if (cid && userDocId && !resultado.shouldCreateOrder) {
        salvarMensagem(
          cid, userDocId, "assistant", cleanTextFormatado,
          flowStateAntes, wFlowState,
          tagsDetectadas, produtosCardIds, null
        ).catch(console.error);
        atualizarConversa(userDocId, cid, {
          flowStateAtual:       wFlowState,
          carrinhoFinal:        wCart,
          customerDataColetado: wCustomerData,
        }).catch(console.error);
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
      textareaRef.current?.focus();
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
      sincronizarItemCarrinho(companyId, userDocId, { ...produto, quantity: novaQtd }).catch(console.error);
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
  const ultimaMensagemAgente = [...mensagens].reverse().find((m) => m.role === "assistant");
  const ultimaMensagemTemChips = (ultimaMensagemAgente?.suggestions?.length ?? 0) > 0;
  const quickReplies = ultimaMensagemTemChips ? [] : getQuickReplies(flowState, carrinho.length);
  // Chat tem conteúdo se há mensagem de welcome OU mensagens de auth (não mostra tela de loading)
  const saudacaoInicialCarregada = mensagens.length > 0;

  const handleAdicionarQtdCarrinho = (item: CartItem) => {
    const novaQtd = item.quantity + 1;
    setCarrinho(prev => prev.map(i => i.id === item.id ? { ...i, quantity: novaQtd } : i));
    if (userDocId) {
      sincronizarItemCarrinho(companyId, userDocId, { ...item, quantity: novaQtd }).catch(console.error);
    }
  };

  const handleRemoverQtdCarrinho = (item: CartItem) => {
    if (item.quantity <= 1) {
      setCarrinho(prev => prev.filter(i => i.id !== item.id));
      if (userDocId) removerItemCarrinhoFirestore(companyId, userDocId, item.id).catch(console.error);
    } else {
      const novaQtd = item.quantity - 1;
      setCarrinho(prev => prev.map(i => i.id === item.id ? { ...i, quantity: novaQtd } : i));
      if (userDocId) sincronizarItemCarrinho(companyId, userDocId, { ...item, quantity: novaQtd }).catch(console.error);
    }
  };

  const handleRemoverItemCompleto = (itemId: string) => {
    setCarrinho(prev => prev.filter(i => i.id !== itemId));
    if (userDocId) removerItemCarrinhoFirestore(companyId, userDocId, itemId).catch(console.error);
  };

  const formatarPrecoCarrinho = (preco: number) =>
    preco.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // -------- Sincronizar diff de carrinho (nível de componente) --------
  const sincronizarDiffCarrinho = (cartAntes: CartItem[], cartDepois: CartItem[]) => {
    if (!userDocId) return;
    for (const novoItem of cartDepois) {
      const itemAnterior = cartAntes.find(i => i.id === novoItem.id);
      if (!itemAnterior || itemAnterior.quantity !== novoItem.quantity) {
        sincronizarItemCarrinho(companyId, userDocId, novoItem).catch(console.error);
      }
    }
    for (const itemAnterior of cartAntes) {
      if (!cartDepois.find(i => i.id === itemAnterior.id)) {
        removerItemCarrinhoFirestore(companyId, userDocId, itemAnterior.id).catch(console.error);
      }
    }
  };

  // -------- Salvar resposta do agente (nível de componente, fora do enviarMensagem) --------
  const salvarRespostaAgente = async (content: string, produtosCard?: Produto[], suggestions?: string[], termoBusca?: string) => {
    const contentFormatado = limparMarkdownBasico(content);
    setMensagens(prev => [...prev, {
      id: `assistant-local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: "assistant" as const,
      content: contentFormatado,
      timestamp: new Date(),
      produtosCard: produtosCard?.length ? produtosCard : undefined,
      termoBusca: produtosCard?.length ? termoBusca : undefined,
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
            `Estas são as opções de ${itemProx.termoBusca} que temos hoje${sufixo}. Para adicionar no pedido é só clicar no "+" ao lado do produto. ⬇️`,
            opcoes,
            ["Cancelar item"],
            itemProx.termoBusca
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
  if (authLoading || (user !== null && !saudacaoInicialCarregada)) {
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

  const precisaLogin = !isGuestMode && (!user || user.isAnonymous) && !loginCompleto;

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className={styles.container} style={{ paddingTop: headerOffset }}>
      <div id="recaptcha-container"></div>
      <Header
        nomeEstabelecimento={nomeEstabelecimento}
        cartTotal={totalCarrinho}
        cartCount={qtdItens}
        onAbrirCarrinho={() => setMostrarCarrinho(true)}
        onTotalHeightChange={setHeaderOffset}
        nomeCliente={nomeCliente}
        userCpf={userCpf}
        userPhone={userPhone}
        enderecoSalvo={enderecoSalvo}
        onSalvarPerfil={async ({ nome, cpf, telefone }) => {
          if (!userDocId) return;
          await atualizarDadosUsuario(userDocId, { nomeCompleto: nome, cpf, telefone });
          setNomeCliente(nome);
          setUserCpf(cpf);
          setUserPhone(telefone);
        }}
        onSalvarEndereco={async (end) => {
          if (!userDocId) return;
          await salvarEnderecoDefault(userDocId, end);
          setEnderecoSalvo(end);
        }}
        isGuestMode={isGuestMode}
        precisaLogin={precisaLogin}
        onLogout={() => {
          if (userDocId) limparCarrinhoFirestore(companyId, userDocId).catch(console.error);
          setCarrinho([]);
          setUserDocId(null);
          setNomeCliente('Cliente');
          setUserCpf('');
          setUserPhone('');
          setLoginCompleto(false);
          setAuthStep('phone');
          setAuthPhone('');
          setAuthCode('');
          setAuthConfirmation(null);
          if (window.recaptchaVerifier) { window.recaptchaVerifier.clear(); window.recaptchaVerifier = undefined; }
          recaptchaAuthRef.current = undefined;
          // NÃO resetar authIniciado para o useEffect não substituir as mensagens
          // Mensagens de logout com delay natural (typing indicator)
          setAuthDigitando(true);
          setTimeout(() => {
            setMensagens(prev => [...prev, {
              id: `logout-${Date.now()}`, role: 'assistant' as const,
              content: 'Você saiu da conta com sucesso.', timestamp: new Date(),
            }]);
            setTimeout(() => {
              setMensagens(prev => [...prev, {
                id: `auth-r-0-${Date.now()}`, role: 'assistant' as const,
                content: 'Olá! 👋 Para continuar, informe seu número de telefone com DDD:', timestamp: new Date(),
              }]);
              setAuthDigitando(false);
            }, 1000);
          }, 700);
        }}
        carouselEnabled={carouselEnabled}
        onCarouselChange={(val) => {
          setCarouselEnabled(val);
          localStorage.setItem('testConfig_carouselEnabled', String(val));
        }}
        wordKeysEnabled={wordKeysEnabled}
        onWordKeysChange={(val) => {
          setWordKeysEnabled(val);
          localStorage.setItem('testConfig_wordKeysEnabled', String(val));
        }}
      />

      {/* Barra de progresso do checkout */}
      {!precisaLogin && flowState !== FLOW_STATES.BROWSING && (
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${progressoCheckout}%` }}
          />
        </div>
      )}

      {/* Backdrop do carrinho */}
      {!precisaLogin && mostrarCarrinho && (
        <div className={styles.agCarrinhoBackdrop} onClick={() => setMostrarCarrinho(false)} />
      )}

      {/* Sidebar do carrinho */}
      <div className={`${styles.agCarrinhoSidebar} ${mostrarCarrinho ? styles.agCarrinhoSidebarOpen : ''}`}>
        {mostrarCarrinho && <button className={styles.agCarrinhoSidebarClose} onClick={() => setMostrarCarrinho(false)}>
          <X size={22} />
        </button>}

        {mostrarCarrinho && <div className={styles.agCarrinhoInner}>
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
              </dl>
              <button
                className={styles.agFinalizarBtn}
                onClick={() => { setMostrarCarrinho(false); setShowCheckout(true); }}
              >
                Finalizar pedido 🛒
              </button>
            </div>
          )}
        </div>}
      </div>

      {/* Chat wrapper — fundo arredondado */}
      <div className={styles.chatWrapper}>

      {/* Mensagens */}
      <div className={styles.messagesContainer}>

        {/* ── Todas as mensagens (auth + chat) no mesmo fluxo ── */}
        {mensagens.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.messageWrapper} ${
              msg.role === "user"
                ? styles.messageWrapperUser
                : styles.messageWrapperAgent
            }`}
          >

            <div className={styles.messageColumn}>
              {/* Card especial: boas-vindas estilizado */}
              {msg.isWelcomeCard ? (
                <WelcomeCard
                  logoUrl={logoEstabelecimento}
                  nomeEstabelecimento={nomeEstabelecimento}
                />
              ) : msg.authCheckboxCard ? (
                <AuthCheckboxCard
                  authKeepLogged={authKeepLogged}
                  onChangeKeepLogged={setAuthKeepLogged}
                  authAcceptTerms={authAcceptTerms}
                  onChangeAcceptTerms={setAuthAcceptTerms}
                  authSending={authSending}
                  onResend={handleAuthResend}
                />
              ) : msg.content.trim() ? (
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
              ) : null}

              {/* Cards de produto — carrossel único */}
              {!msg.produtosCard && (msg.skeletonCardCount ?? 0) > 0 && (
                <div className={styles.produtosCarousel}>
                  {Array.from({ length: msg.skeletonCardCount ?? 0 }).map((_, i) => (
                    <div key={i} className={styles.skeletonCard} />
                  ))}
                </div>
              )}

              {msg.produtosCard && msg.produtosCard.length > 0 && (() => {
                const isCarousel = carouselEnabled;
                const attachDrag = (el: HTMLDivElement | null) => {
                  if (!el) return;
                  const onDown = (e: MouseEvent) => { carouselDragRef.current = { el, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft, dragging: true }; el.style.cursor = 'grabbing'; };
                  const onMove = (e: MouseEvent) => { const d = carouselDragRef.current; if (!d || !d.dragging || d.el !== el) return; e.preventDefault(); el.scrollLeft = d.scrollLeft - (e.pageX - el.offsetLeft - d.startX); };
                  const onUp = () => { if (carouselDragRef.current?.el === el) { carouselDragRef.current!.dragging = false; el.style.cursor = 'grab'; } };
                  el.style.cursor = 'grab';
                  el.addEventListener('mousedown', onDown);
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                };
                return (
                  <div className={isCarousel ? styles.produtosCarousel : styles.produtosCardWrapper} ref={isCarousel ? attachDrag : undefined}>
                    {msg.produtosCard!.map((produto) => {
                      const emCarrinho = carrinho.find(i => i.id === produto.id);
                      const nomeExibido = traduzirAbreviacoes(produto.name);
                      const abrirModal = () => setImagemAmpliada({ src: produto.image ?? '/prodSemImg.svg', name: nomeExibido, price: produto.price });
                      return (
                        <div key={produto.id} className={isCarousel ? styles.produtoCarouselItem : styles.produtoCardRow}>
                          <div className={`${styles.produtoCard} ${emCarrinho ? styles.produtoCardAtivo : ''}`}>
                            <div className={styles.produtoCardImgWrapper} onClick={abrirModal} title="Ver detalhes">
                              <Image src={produto.image || '/prodSemImg.svg'} alt={nomeExibido} fill className={styles.produtoCardImg} sizes="140px" onError={(e) => { (e.target as HTMLImageElement).src = '/prodSemImg.svg'; }} />
                            </div>
                            <div className={styles.produtoCardInfo}>
                              <p className={styles.produtoCardName} onClick={abrirModal} style={{ cursor: 'pointer' }}>{nomeExibido}</p>
                              <p className={styles.produtoCardPrice}>R$ {produto.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                            {flowState === FLOW_STATES.BROWSING && (
                              <div className={styles.produtoCardControls}>
                                {emCarrinho ? (
                                  <>
                                    <button className={styles.produtoCardQtyBtn} onClick={() => handleRemoverQtdCarrinho(emCarrinho)}><Minus size={16} color="#BF1E2E" /></button>
                                    <span className={styles.produtoCardQtyNum}>{emCarrinho.quantity}</span>
                                  </>
                                ) : null}
                                <button className={styles.produtoCardAddBtn} onClick={() => { const emSelecao = (itemUnicoQtdState && (itemUnicoQtdState.stage === "choose_other" || itemUnicoQtdState.stage === "confirm_single")) || (listaPedidoState && listaPedidoState.stage === "selecting_variant"); if (emSelecao && !emCarrinho) { selecionarVarianteCard(produto); } else { adicionarSilencioso(produto); } }} title={emCarrinho ? `Mais 1 ${nomeExibido}` : `Adicionar ${nomeExibido}`}>
                                  <Plus size={emCarrinho ? 16 : 22} color="#193281" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Card "Ver todos" — aparece no fim do carrossel quando há termoBusca */}
                    {isCarousel && msg.termoBusca && (
                      <div className={styles.produtoCarouselItem}>
                        <button
                          className={styles.verTodosCard}
                          onClick={() => {
                            const todos = wordKeysEnabled
                              ? filtrarProdutosWordKeys(msg.termoBusca!, produtos)
                              : filtrarProdutos(msg.termoBusca!, produtos);
                            setMensagens(prev => prev.map(m =>
                              m.id === msg.id ? { ...m, produtosCard: todos, termoBusca: undefined } : m
                            ));
                          }}
                        >
                          <span className={styles.verTodosIcon}>+</span>
                          <span className={styles.verTodosLabel}>Ver todos</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

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
                  {quickReplies.length > 0 && (
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
        {((!precisaLogin && enviando) || authDigitando) && (
          <div className={`${styles.messageWrapper} ${styles.messageWrapperAgent}`}>
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
              {imagemAmpliada.src && imagemAmpliada.src !== '/prodSemImg.svg' ? (
                <Image
                  src={imagemAmpliada.src}
                  alt={imagemAmpliada.name}
                  fill
                  className={styles.lightboxImg}
                  sizes="400px"
                  onError={() => setImagemAmpliada(prev => prev ? { ...prev, src: '/prodSemImg.svg' } : null)}
                />
              ) : (
                <Image
                  src="/prodSemImg.svg"
                  alt={imagemAmpliada.name}
                  fill
                  className={styles.lightboxImg}
                  sizes="400px"
                />
              )}
            </div>
            <p className={styles.lightboxName}>{imagemAmpliada.name}</p>
            <p className={styles.lightboxPrice}>R$ {imagemAmpliada.price.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Painel de configurações (apenas modo teste) */}

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


      {/* Barra inferior: input + info strip */}
      <div className={styles.bottomBar}>
      <div className={styles.inputContainer}>
        {precisaLogin ? (
          <input
            ref={inputRef}
            type={authStep !== 'code_modal' ? "tel" : "text"}
            inputMode={authStep === 'code_modal' ? "numeric" : undefined}
            maxLength={authStep === 'code_modal' ? 6 : undefined}
            placeholder={authStep === 'code_modal' ? "000000" : "(11) 99999-9999"}
            className={styles.messageInput}
            style={authStep === 'code_modal' ? { letterSpacing: '0.4em', textAlign: 'center', fontSize: '1.1rem', fontWeight: 700 } : undefined}
            value={authStep === 'code_modal' ? authCode : authPhone}
            onChange={(e) => {
              if (authStep === 'code_modal') { setAuthCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setAuthCodeError(''); }
              else { setAuthPhone(formatPhoneAuth(e.target.value)); }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (authStep === 'code_modal') handleAuthVerifyCode();
                else handleAuthSendCode();
              }
            }}
            disabled={authSending || authStep === 'validating' || (authStep === 'code_modal' && !authAcceptTerms)}
          />
        ) : (
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={!produtosCarregados ? "Carregando produtos..." : transcrevendo ? "Transcrevendo..." : gravando ? "Gravando..." : "Digite sua mensagem..."}
            className={styles.messageTextarea}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              // Auto-resize
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={(e) => {
              // Enter quebra linha; envio só pelo botão
            }}
            disabled={enviando || !produtosCarregados || (process.env.NEXT_PUBLIC_VOICE_ENABLED === 'true' && (gravando || transcrevendo))}
          />
        )}
        {!precisaLogin && process.env.NEXT_PUBLIC_VOICE_ENABLED === 'true' && (
          <button
            className={`${styles.micButton} ${gravando ? styles.micButtonGravando : ""}`}
            onClick={gravando ? pararGravacao : iniciarGravacao}
            disabled={enviando || transcrevendo}
            aria-label={gravando ? "Parar gravação" : "Gravar mensagem de voz"}
          >
            {transcrevendo ? (
              <Loader2 size={18} className={styles.spinnerIcon} />
            ) : (
              <Mic size={18} />
            )}
          </button>
        )}
        <button
          className={styles.sendButton}
          onClick={() => {
            if (!precisaLogin) enviarMensagem();
            else if (authStep === 'code_modal') handleAuthVerifyCode();
            else handleAuthSendCode();
          }}
          disabled={
            !precisaLogin ? (!inputText.trim() || enviando || !produtosCarregados) :
            authStep === 'code_modal' ? (authCode.length !== 6 || !authAcceptTerms || authSending) :
            (!authPhone.trim() || authSending || authStep === 'validating')
          }
          aria-label="Enviar mensagem"
        >
          {(precisaLogin ? authSending : enviando) ? (
            <Loader2 size={20} className={styles.spinnerIcon} />
          ) : (
            <Send size={20} />
          )}
        </button>
      </div>{/* /inputContainer */}

      {/* Info strip — dentro da barra inferior, só quando logado */}
      {!precisaLogin && <InfoBar info={infoEstabelecimento} />}
      </div>{/* /bottomBar */}

      </div>{/* /chatWrapper */}

      {/* Modal de checkout */}
      {showCheckout && userDocId && (
        <CheckoutModal
          carrinho={carrinho}
          userDocId={userDocId}
          companyId={companyId}
          nomeCliente={nomeCliente}
          formasPagamento={formasPagamento.length > 0 ? formasPagamento : ["Pix", "Dinheiro", "Cartão Crédito", "Cartão Débito"]}
          subtotal={totalCarrinho}
          taxaEntrega={DELIVERY_PRICE}
          onClose={() => setShowCheckout(false)}
          onSuccess={(orderNumber, total) => {
            setShowCheckout(false);
            setCarrinho([]);
            if (userDocId) limparCarrinhoFirestore(companyId, userDocId).catch(console.error);
            setMensagens((prev) => [...prev, {
              id:        `pedido-modal-${Date.now()}`,
              role:      "assistant" as const,
              content:   `✅ Pedido #${orderNumber} confirmado!\nTotal: R$ ${total.toFixed(2).replace('.', ',')}\n\nObrigado pela preferência! Posso ajudar com mais alguma coisa? 😊`,
              timestamp: new Date(),
            }]);
          }}
        />
      )}

    </div>
  );
};

export default AgentePage;
