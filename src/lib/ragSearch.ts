import type { FewShotExemplo, Produto } from "@/lib/buildSystemPrompt";
import {
  ALIASES_BUSCA,
  expandirPalavrasBusca,
  extrairPalavrasBaseBusca,
  normalizar,
  singularizar,
} from "@/lib/productSearch";
import type { ExemploConversa } from "@/services/firestore";

type Scored<T> = {
  item: T;
  score: number;
  reasons: string[];
};

const DEFAULT_STOPWORDS = new Set([
  "quero",
  "queria",
  "preciso",
  "procuro",
  "busco",
  "tem",
  "voces",
  "voce",
  "pode",
  "por",
  "favor",
  "comprar",
  "pedido",
  "produto",
  "produtos",
]);

function tokenize(texto: string): string[] {
  return normalizar(texto)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .filter((w) => !DEFAULT_STOPWORDS.has(w));
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function productCorpus(produto: Produto): string {
  return [
    produto.name,
    produto.description,
    produto.category,
    produto.subcategory,
    produto.unityType,
    produto.barCode,
    ...(produto.tags ?? []),
    ...(produto.wordKeys ?? []),
    ...(produto.searchIndex ?? []),
  ].filter(Boolean).join(" ");
}

function scoreCorpus(queryTokens: string[], expandedTokens: string[], corpus: string) {
  const corpusNorm = normalizar(corpus);
  const corpusTokens = tokenize(corpusNorm);
  const corpusSet = new Set(corpusTokens);
  let score = 0;
  const reasons: string[] = [];

  for (const token of queryTokens) {
    const formas = unique([token, ...singularizar(token), ...(ALIASES_BUSCA[token] ?? []).map(normalizar)]);
    if (formas.some((f) => corpusSet.has(f))) {
      score += 14;
      reasons.push(`match:${token}`);
      continue;
    }
    if (formas.some((f) => f.length >= 4 && corpusNorm.includes(f))) {
      score += 7;
      reasons.push(`partial:${token}`);
    }
  }

  for (const token of expandedTokens) {
    if (token.length >= 3 && corpusSet.has(token)) score += 3;
  }

  return { score, reasons };
}

export function buscarProdutosRag(texto: string, produtos: Produto[], limite = 20): Produto[] {
  const queryTokens = unique([...extrairPalavrasBaseBusca(texto), ...tokenize(texto)]);
  if (queryTokens.length === 0) return [];

  const expandedTokens = unique(expandirPalavrasBusca(queryTokens));
  const scored: Scored<Produto>[] = produtos
    .map((produto) => {
      const corpus = productCorpus(produto);
      const { score: baseScore, reasons } = scoreCorpus(queryTokens, expandedTokens, corpus);
      if (baseScore <= 0) return { item: produto, score: 0, reasons: [] };

      let score = baseScore;
      const nameNorm = normalizar(produto.name);
      const categoryNorm = normalizar(`${produto.category} ${produto.subcategory}`);

      for (const token of queryTokens) {
        if (nameNorm.split(/\s+/).includes(token)) score += 12;
        else if (nameNorm.includes(token) && token.length >= 4) score += 6;
        if (categoryNorm.includes(token)) score += 5;
      }

      if ((produto.stock ?? 0) > 0) score += 2;
      if (produto.stock === 0) score -= 30;

      return { item: produto, score, reasons };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limite).map((entry) => entry.item);
}

export function combinarResultadosRag(prioritarios: Produto[], rag: Produto[], limite = 20): Produto[] {
  const out: Produto[] = [];
  const ids = new Set<string>();

  for (const produto of prioritarios) {
    if (out.length >= limite) return out;
    if (ids.has(produto.id)) continue;
    ids.add(produto.id);
    out.push(produto);
  }

  for (const produto of rag) {
    if (out.length >= limite) break;
    if (ids.has(produto.id)) continue;
    ids.add(produto.id);
    out.push(produto);
  }

  return out;
}

function exemploCorpus(exemplo: ExemploConversa): string {
  return [
    exemplo.nome,
    ...exemplo.mensagens.map((m) => `${m.role}: ${m.content}`),
  ].join("\n");
}

export function selecionarExemplosRag(texto: string, exemplos: ExemploConversa[], limite = 4): FewShotExemplo[] {
  const queryTokens = unique([...extrairPalavrasBaseBusca(texto), ...tokenize(texto)]);
  if (queryTokens.length === 0) return exemplos.slice(0, limite).map(toFewShot);

  const expandedTokens = unique(expandirPalavrasBusca(queryTokens));
  return exemplos
    .map((exemplo) => {
      const { score } = scoreCorpus(queryTokens, expandedTokens, exemploCorpus(exemplo));
      return { item: exemplo, score, reasons: [] };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)
    .map((entry) => toFewShot(entry.item));
}

function toFewShot(exemplo: ExemploConversa): FewShotExemplo {
  return {
    mensagens: exemplo.mensagens.map((m) => ({ role: m.role, content: m.content })),
  };
}

export function buildRagContext(texto: string, produtosRag: Produto[]): string {
  if (produtosRag.length === 0) return "";
  const linhas = produtosRag.slice(0, 8).map((p) => {
    const tags = [...(p.tags ?? []), ...(p.wordKeys ?? [])].slice(0, 8).join(", ");
    return `- ${p.name} | categoria=${p.category}/${p.subcategory || "-"} | tags=${tags || "-"}`;
  });

  return [
    `Consulta do cliente: "${texto}"`,
    "Produtos recuperados por RAG local para apoiar a decisão do catálogo:",
    ...linhas,
    "Use esse contexto apenas para escolher IDs do CATÁLOGO INTERNO; não escreva nomes de produtos no texto.",
  ].join("\n");
}
