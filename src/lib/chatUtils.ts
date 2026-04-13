/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Produto, CartItem } from "@/lib/buildSystemPrompt";
import type { User } from "firebase/auth";
import { normalizar, extrairPalavrasBaseBusca } from "@/lib/productSearch";

// ── Detecção de intenção ────────────────────────────────────────────────────

export function ehSaudacaoCurta(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, " ").trim().replace(/\s+/g, " ");
  return new Set(["oi", "ola", "bom dia", "boa tarde", "boa noite", "e ai", "tudo bem", "blz"]).has(t);
}

export function ehIntencaoSemProduto(texto: string): boolean {
  const t = normalizar(texto);
  return (
    t.includes("lista de compras") ||
    t.includes("tenho uma lista") ||
    t.includes("novo pedido") ||
    t.includes("fazer um pedido") ||
    t.includes("fazer pedido") ||
    t.includes("comecar pedido") ||
    t.includes("iniciar pedido") ||
    t.includes("quero pedir") ||
    t.includes("vou pedir")
  );
}

export function ehIntencaoCheckout(texto: string): boolean {
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

export function ehAcaoContinuarComprando(texto: string): boolean {
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

export function ehAcaoAlterarItem(texto: string): boolean {
  const t = normalizar(texto).replace(/[.!?]/g, "").trim();
  return (
    t === "alterar" ||
    t.includes("alterar") ||
    t.includes("trocar") ||
    t.includes("substituir") ||
    t.includes("mudar item")
  );
}

export function ehConfirmacaoPositiva(texto: string): boolean {
  const t = normalizar(texto).replace(/[.!?]/g, "").trim();
  return (
    ["sim", "s", "ok", "pode", "confirmar", "confirmo", "certo", "isso", "1"].includes(t) ||
    t.startsWith("confirmar")
  );
}

export function ehCancelamento(texto: string): boolean {
  const t = normalizar(texto).replace(/[.!?]/g, "").trim();
  return ["cancelar", "cancelo", "cancela", "nao", "não", "2", "parar", "sair"].includes(t);
}

export function ehEscolhaAutomatica(texto: string): boolean {
  const t = normalizar(texto);
  return t.includes("popular") || t.includes("automatic") || t.includes("autom") || t.includes("preench");
}

export function ehEscolhaVariacao(texto: string): boolean {
  const t = normalizar(texto);
  return t.includes("variedad") || t.includes("escolher") || t.includes("selecion") || t.includes("opcao") || t.includes("opção");
}

export function encontrarIndiceEscolhido(texto: string, limite: number): number | null {
  const t = normalizar(texto);
  const m = t.match(/\b(\d+)\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= limite) return n - 1;
  return null;
}

// ── Formatação de texto ─────────────────────────────────────────────────────

export function limparMarkdownBasico(texto: string): string {
  return texto
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .split("\n")
    .filter((linha) => !/adicionei|coloquei|adicionado|colocado/i.test(linha) || !/carrinho/i.test(linha))
    .join("\n")
    .trim();
}

export function resumirTextoQuandoHaCards(texto: string, temCards: boolean): string {
  if (!temCards) return texto.trim();

  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);

  const filtradas = linhas.filter((linha) => {
    if (/^\d+\.\s+/.test(linha)) return false;
    if (/^-\s+\S/.test(linha)) return false;
    if (/^•\s+\S/.test(linha)) return false;
    if (/R\$\s*\d/.test(linha) && linha.length <= 90) return false;
    return true;
  });

  const resultado = filtradas.join("\n").trim();
  return resultado || "Encontrei estas opcoes para voce. Qual voce prefere?";
}

// ── Extração de listas de itens ─────────────────────────────────────────────

export const NUMERO_POR_TEXTO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, "três": 3,
  quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

export function numeroDaString(valor: string): number | null {
  const limpo = normalizar(valor.trim());
  if (/^\d+$/.test(limpo)) return parseInt(limpo, 10);
  return NUMERO_POR_TEXTO[limpo] ?? null;
}

export function limparTermoItemLista(termo: string): string {
  return termo
    .replace(/\b(de|da|do|das|dos|com|sem|para|pra)\b/gi, " ")
    .replace(/\b(caixa|caixas|pacote|pacotes|sacola|sacolas|unidade|unidades|lata|latas|garrafa|garrafas)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extrairItensListaComQuantidade(
  texto: string
): Array<{ termoOriginal: string; termoBusca: string; quantidade: number }> {
  // Normaliza quebras de linha para vírgula para que o regex funcione corretamente
  const textoNorm = texto.replace(/\n+/g, ", ");
  const itens: Array<{ termoOriginal: string; termoBusca: string; quantidade: number }> = [];
  const pattern =
    /\b(\d+|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\b\s+([^,]+?)(?=(?:,|\be\b\s*(?:\d+|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\b|$))/gi;

  for (const match of textoNorm.matchAll(pattern)) {
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

export function extrairItensSimples(
  texto: string
): Array<{ termoOriginal: string; termoBusca: string; quantidade: number }> {
  if (texto.trim().endsWith("?")) return [];

  // Prioridade 1: quebra de linha (usuário colou uma lista)
  const temQuebraLinha = texto.includes("\n");
  if (temQuebraLinha) {
    const candidatos = texto.split("\n").map((p) => p.trim()).filter(Boolean);
    if (candidatos.length >= 2) {
      const itens: Array<{ termoOriginal: string; termoBusca: string; quantidade: number }> = [];
      for (const c of candidatos) {
        const termoOriginal = c;
        const termoBusca = limparTermoItemLista(termoOriginal);
        const palavrasValidas = extrairPalavrasBaseBusca(termoBusca);
        if (palavrasValidas.length === 0) continue;
        itens.push({ termoOriginal, termoBusca, quantidade: 1 });
      }
      if (itens.length >= 2) return itens;
    }
  }

  // Prioridade 2: vírgula
  const porVirgula = texto.split(",").map((p) => p.trim()).filter(Boolean);

  let candidatos: string[];
  if (porVirgula.length >= 2) {
    const ultima = porVirgula[porVirgula.length - 1];
    const partsE = ultima.split(/\se\s/i).map((p) => p.trim()).filter(Boolean);
    candidatos = [...porVirgula.slice(0, -1), ...partsE];
  } else {
    const partsE = texto.split(/\se\s/i).map((p) => p.trim()).filter(Boolean);
    if (partsE.length < 2) return [];
    candidatos = partsE;
  }

  const itens: Array<{ termoOriginal: string; termoBusca: string; quantidade: number }> = [];
  for (const c of candidatos) {
    const termoOriginal = c.trim();
    if (!termoOriginal) continue;
    const termoBusca = limparTermoItemLista(termoOriginal);
    const palavrasValidas = extrairPalavrasBaseBusca(termoBusca);
    if (palavrasValidas.length === 0) continue;
    itens.push({ termoOriginal, termoBusca, quantidade: 1 });
  }
  return itens;
}

// ── Carrinho ────────────────────────────────────────────────────────────────

export function formatarResumoCarrinho(cart: CartItem[]): string {
  if (cart.length === 0) return "Carrinho vazio.";
  return cart
    .map((i) => `${i.quantity}x ${i.name} - R$ ${(i.price * i.quantity).toFixed(2)}`)
    .join("\n");
}

export function adicionarItemAoCarrinhoFn(cartAtual: CartItem[], produto: Produto, quantidade: number): CartItem[] {
  const existente = cartAtual.find((i) => i.id === produto.id);
  if (existente) {
    return cartAtual.map((i) => i.id === produto.id ? { ...i, quantity: i.quantity + quantidade } : i);
  }
  return [...cartAtual, { ...produto, quantity: quantidade }];
}

export function proximoIndicePendenteFn(
  itens: Array<{ selecionadoId?: string; cancelado?: boolean }>,
  atual: number
): number {
  for (let i = atual + 1; i < itens.length; i++) {
    if (!itens[i].selecionadoId && !itens[i].cancelado) return i;
  }
  return -1;
}

// ── Usuário ─────────────────────────────────────────────────────────────────

export function montarNomeCompletoUsuario(data: any, currentUser: User): string {
  const nomeDireto =
    data?.nomeCompleto || data?.fullName || data?.name || data?.nome || currentUser.displayName || "";

  const nomeDiretoLimpo = String(nomeDireto).trim();
  if (nomeDiretoLimpo.includes(" ")) return nomeDiretoLimpo;

  const sobrenome = String(data?.sobrenome || data?.lastName || data?.surname || "").trim();

  if (nomeDiretoLimpo && sobrenome) return `${nomeDiretoLimpo} ${sobrenome}`.trim();
  return nomeDiretoLimpo || "Cliente";
}
