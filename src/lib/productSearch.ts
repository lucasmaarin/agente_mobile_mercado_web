import type { Produto } from "@/lib/buildSystemPrompt";

/** Remove acentos e converte para minúsculas para comparação */
export function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Retorna formas alternativas singulares de uma palavra em português.
 * Ex: "derivados" → ["derivado"], "feijoes" → ["feijao"], "animais" → ["animal"]
 * Retorna array vazio se a palavra já parece singular ou não tem regra aplicável.
 */
export function singularizar(w: string): string[] {
  if (w.length <= 3) return [];
  // ões / oes → ão / ao
  if (w.endsWith("oes")) return [w.slice(0, -3) + "ao"];
  // ães / aes → ão / ao
  if (w.endsWith("aes")) return [w.slice(0, -3) + "ao"];
  // ais → al (animais → animal)
  if (w.endsWith("ais")) return [w.slice(0, -2) + "l"];
  // eis → el (papeis → papel)
  if (w.endsWith("eis")) return [w.slice(0, -2) + "l"];
  // ois → ol (anzois → anzol)
  if (w.endsWith("ois")) return [w.slice(0, -2) + "l"];
  // uis → ul
  if (w.endsWith("uis")) return [w.slice(0, -2) + "l"];
  // ns → m (bens → bem, etc.)
  if (w.endsWith("ns") && w.length > 4) return [w.slice(0, -2) + "m"];
  // es final (plural de palavras terminadas em r, z, s, x) — remove "es"
  if (w.endsWith("es") && w.length > 4) return [w.slice(0, -2)];
  // s simples → remove s (derivados → derivado, leites → leite)
  if (w.endsWith("s")) return [w.slice(0, -1)];
  return [];
}

// Stopwords removidas ao processar tags
const TAG_STOPWORDS = new Set(["de", "do", "da", "dos", "das", "e", "o", "a"]);

// Stopwords que podem aparecer embutidas em tags concatenadas (#derivadodoleite → derivado+leite)
const STOP_EMBUTIDAS = ["dos", "das", "do", "da", "de"];

/**
 * Expande uma tag em tokens normalizados, tratando:
 * - underscores como espaço (#leite_integral → ["leite", "integral"])
 * - stopwords ("de", "do", "da"…) removidas (#leite_de_caixinha → ["leite", "caixinha"])
 * - tags com espaços (#derivado do leite → ["derivado", "leite"])
 * - stopwords embutidas sem separador (#derivadodoleite → ["derivado", "leite"])
 */
export function expandirTag(tag: string): string[] {
  // 1. Normaliza formatação inconsistente de tags vindas do catálogo:
  // aceita espaços, múltiplos # e "_" como separador.
  const limpa = tag
    .trim()
    .replace(/^#+/, "")
    .replace(/#/g, "")
    .replace(/_/g, " ")
    .trim();
  const norm = normalizar(limpa);

  // 2. Se tem espaços, split e filtra stopwords
  if (norm.includes(" ")) {
    return norm.split(/\s+/).filter(t => t.length >= 2 && !TAG_STOPWORDS.has(t));
  }

  // 3. Tag sem espaços: tenta separar stopwords embutidas (ex: derivadodoleite → derivado+leite)
  for (const stop of STOP_EMBUTIDAS) {
    const idx = norm.indexOf(stop);
    if (idx > 1 && idx + stop.length < norm.length - 1) {
      const antes = norm.slice(0, idx);
      const depois = norm.slice(idx + stop.length);
      if (antes.length >= 2 && depois.length >= 2) {
        return [antes, depois].filter(t => !TAG_STOPWORDS.has(t));
      }
    }
  }

  // 4. Token simples
  return norm.length >= 1 ? [norm] : [];
}

/** Retorna todos os tokens normalizados das tags de um produto. */
function tokensTagsProduto(tags: string[]): string[] {
  return tags.flatMap(expandirTag);
}

export const STOPWORDS_BUSCA = new Set([
  "oi", "ola", "boa", "bom", "dia", "tarde", "noite", "olas", "hello", "hi", "hey", "boas",
  "obrigado", "obrigada", "brigado", "brigada", "valeu", "vlw", "tks",
  "tem", "tenho", "quero", "queria", "preciso", "procuro", "busco",
  "me", "pra", "para", "com", "sem", "um", "uma", "uns", "umas", "dos", "das",
  "por", "favor", "pode", "poderia", "gostaria", "de", "do", "da", "em", "tal", "coisa",
  "mais", "opcao", "opcoes", "outro", "outros", "outra", "outras", "tipo", "tipos",
  "algo", "algum", "alguma", "alguns", "algumas", "qual", "quais", "voce", "nao", "sim",
  "novo", "nova", "lista", "pedido", "compra", "compras", "item", "itens",
  "ha", "ai", "ah", "so", "ate", "ou", "que", "se", "ja", "la", "ca",
  "tudo", "nada", "ainda", "agora", "aqui", "ali", "isso", "esse", "essa", "esses", "essas",
  "produtos", "produto", "marca", "marcas", // ← palavras relacionadas a busca por marca
  // embalagens removidas das stopwords — são especificadores válidos (ex: "leite de caixinha")
]);

export const ALIASES_BUSCA: Record<string, string[]> = {
  // embalagens → tokens de tag equivalentes (tetrapak/caixinha/caixa são sinônimos)
  caixinha: ["tetrapak", "caixa"],
  caxinha:  ["tetrapak", "caixinha", "caixa"], // variante ortográfica comum
  caixa:    ["tetrapak", "caixinha"],
  tetrapak: ["caixinha", "caixa"],             // busca por "tetrapak" também funciona
  garrafa:  ["garrafa", "pet", "vidro"],
  lata:     ["lata", "aluminio"],
  saquinho: ["saquinho", "saco", "bag", "sachet"],
  saco:     ["saquinho", "bag", "sachet"],
  bag:      ["saquinho", "saco", "sachet"],
  pacote:   ["pacote", "pct"],
  pote:     ["pote", "bandeja"],
  vidro:    ["vidro", "vd"],
  // outros
  po:       ["po", "instantaneo", "instantanea"],
  peito:    ["peito", "file"],
  file:     ["file", "peito"],
};

export const CONTEXTOS_SITUACIONAIS: Record<string, string[]> = {
  churrasco:       ["carne", "frango", "linguica", "carvao"],
  macarronada:     ["macarrao", "molho tomate", "queijo ralado"],
  feijoada:        ["feijao preto", "carne seca", "linguica", "farofa"],
  farofa:          ["farinha mandioca", "manteiga"],
  pizza:           ["queijo mussarela", "molho tomate"],
  vitamina:        ["banana", "aveia", "leite"],
  "compras do mes":["arroz", "feijao", "oleo", "acucar", "sal", "farinha", "cafe", "leite"],
  natal:           ["natal", "panetone", "chocotone", "tender", "peru", "chester", "espumante", "nozes", "castanha"],
  natalino:        ["natal", "panetone", "chocotone", "tender", "peru", "chester"],
  pascoa:          ["pascoa", "ovo pascoa", "ovo de pascoa", "coelho", "trufa"],
  "festa junina":  ["festa junina", "junina", "canjica", "pamonha", "pipoca", "amendoim"],
  reveillon:       ["reveillon", "espumante", "lentilha"],
  "ano novo":      ["ano novo", "espumante", "lentilha"],
  "dia dos namorados": ["namorados", "vinho", "espumante", "bombom", "trufa"],
  "dia das maes":  ["maes", "vinho", "espumante", "bombom"],
  "dia dos pais":  ["pais", "whisky", "vinho"],
  carnaval:        ["carnaval", "energetico"],
};

export function detectarContexto(texto: string): string[] {
  const t = normalizar(texto);
  const termos = new Set<string>();
  for (const [contexto, keywords] of Object.entries(CONTEXTOS_SITUACIONAIS)) {
    if (t.includes(normalizar(contexto))) keywords.forEach((k) => termos.add(k));
  }
  return Array.from(termos);
}

export function detectarNomeContexto(texto: string): string | null {
  const t = normalizar(texto);
  for (const contexto of Object.keys(CONTEXTOS_SITUACIONAIS)) {
    if (t.includes(normalizar(contexto))) return contexto;
  }
  return null;
}

/**
 * Detecta se o cliente está buscando por marca especificamente.
 * Extrai APENAS o nome da marca dos padrões:
 * - "marca X" → X
 * - "produtos da marca X" → X
 * - "produtos X" → X (quando tem 1-2 palavras)
 * - "de marca X" → X
 * - "marca X e Y" → X (pega a primeira marca)
 * 
 * Retorna o nome da marca em minúsculas, ou null se não detectar padrão de marca.
 */
export function detectarBuscaPorMarca(texto: string): string | null {
  const t = normalizar(texto);
  
  // Padrões ordenados do mais específico ao mais genérico
  const padroes = [
    // "produtos da marca X" ou "produtos de marca X"
    /produtos\s+(?:da|de)\s+(?:marca|marcas)\s+(\w+)/,
    // "da marca X" ou "de marca X"
    /(?:da|de)\s+(?:marca|marcas)\s+(\w+)/,
    // "marca X" ou "marcas X"
    /(?:marca|marcas)\s+(\w+)/,
    // "produtos X" (se tiver exatamente 1-2 palavras após "produtos")
    /^produtos\s+(\w+)(?:\s+\w+)?$/,
    // "vocês/você tem (produtos) X" ou "tem produtos X"
    /voce?s?\s+tem\s+(?:produtos?\s+)?(\w+)/,
    /tem\s+produtos?\s+(\w+)/,
    // "gostaria de ver/encontrar X" no final da frase
    /(?:ver|encontrar|comprar|pedir)\s+(?:produtos?\s+)?(\w+)\s*\??$/,
  ];
  
  for (const padrao of padroes) {
    const match = t.match(padrao);
    if (match && match[1] && match[1].length >= 2) {
      // Retorna a marca normalizada
      return match[1];
    }
  }
  
  return null;
}

/**
 * Detecta se o texto é PRINCIPALMENTE uma busca por marca.
 * (com pouca ou nenhuma especificação de tipo de produto)
 * 
 * Exemplos que retornam TRUE:
 * - "produtos da marca nescau"
 * - "marca nescau"
 * - "nescau" (se "nescau" for marca desconhecida)
 * 
 * Exemplos que retornam FALSE:
 * - "leite da marca nescau" (é busca por tipo + marca)
 * - "chocolate nescau" (é busca por produto específico)
 */
export function ehBuscaPuraporMarca(texto: string, catalogo: Produto[]): boolean {
  const t = normalizar(texto);
  
  // Se tem padrão explícito de marca, é busca por marca
  const temPadraoMarca = /(?:marca|marcas|produtos\s+da|de\s+marca)/.test(t);
  if (temPadraoMarca) return true;
  
  // Se é uma palavra única e é marca desconhecida, é busca por marca
  const palavras = extrairPalavrasBaseBusca(texto);
  if (palavras.length === 1) {
    const palavra = palavras[0];
    const temNaTag = catalogo.some((p) =>
      [...(p.tags ?? []), ...(p.wordKeys ?? []), ...(p.searchIndex ?? [])].flatMap(expandirTag).includes(palavra)
    );
    return !temNaTag;
  }
  
  return false;
}

/**
 * Busca produtos por marca com matching mais flexível.
 * Procura a marca como palavras-chave separadas também.
 * 
 * Exemplos:
 * - marca="nescau" encontra "Achocolatado Nescau", "Nescau Chocolate"
 * - marca="nestle" encontra produtos Nestlé com variações ortográficas
 */
export function buscarProdutosPorMarca(marca: string, catalogo: Produto[]): Produto[] {
  const marcaNorm = normalizar(marca);
  const palavrasMarca = extrairPalavrasBaseBusca(marca);

  return catalogo
    .filter((p) => {
      const tokens = [
        ...(p.tags ?? []),
        ...(p.wordKeys ?? []),
        ...(p.searchIndex ?? []),
      ].flatMap(expandirTag);

      if (tokens.some((t) => t === marcaNorm)) return true;

      return palavrasMarca.some((palavra) => {
        const pn = normalizar(palavra);
        return tokens.some((t) => t === pn || t.startsWith(pn));
      });
    })
    .sort((a, b) => calcularScorePorTags(b, marca) - calcularScorePorTags(a, marca));
}

/**
 * Calcula o score de um produto para um texto de busca, usando apenas tags.
 * Útil para ordenar listas de produtos por relevância de tags.
 */
export function calcularScorePorTags(produto: Produto, texto: string): number {
  const palavras = extrairPalavrasBaseBusca(texto);
  if (palavras.length === 0) return 0;
  const tokens = [
    ...(produto.tags ?? []),
    ...(produto.wordKeys ?? []),
    ...(produto.searchIndex ?? []),
  ].flatMap(expandirTag);
  let score = 0;
  for (const w of palavras) {
    for (const forma of [w, ...singularizar(w)]) {
      if (tokens.some((t) => t === forma)) { score += 50; break; }
      if (tokens.some((t) => t.startsWith(forma) && forma.length >= 4)) { score += 10; break; }
    }
  }
  return score;
}

export function variantesToken(token: string): string[] {
  const t = normalizar(token);
  const vars = new Set<string>([t]);
  if (t.length > 4 && t.endsWith("es")) vars.add(t.slice(0, -2));
  if (t.length > 3 && t.endsWith("s")) vars.add(t.slice(0, -1));
  return Array.from(vars);
}

export function extrairPalavrasBaseBusca(texto: string): string[] {
  return normalizar(texto)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOPWORDS_BUSCA.has(w));
}

export function expandirPalavrasBusca(palavrasBase: string[]): string[] {
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

export function buildIndiceCategoria(produtos: Produto[]): string {
  const mapa = new Map<string, { nome: string; subcats: Set<string> }>();
  for (const p of produtos) {
    const chave = p.categoryId || p.category;
    if (!mapa.has(chave)) mapa.set(chave, { nome: p.category, subcats: new Set() });
    if (p.subcategory) mapa.get(chave)!.subcats.add(p.subcategory);
  }
  return Array.from(mapa.values())
    .map(({ nome, subcats }) => `${nome}(${Array.from(subcats).join(",")})`)
    .join(" | ");
}

// Pontuação por posição do termo no nome do produto (índice 0-based).
// Posição 0 (1ª palavra) = 50pts, 1 = 40, 2 = 30, 3+ = 20.
const PTS_NOME_POR_POSICAO = [50, 40, 30, 20] as const;

export function filtrarProdutos(texto: string, produtos: Produto[]): Produto[] {
  const palavrasBase = extrairPalavrasBaseBusca(texto);
  if (palavrasBase.length === 0) return [];

  const comScore = produtos.map((p) => {
    // Palavras do nome normalizadas (usadas para score por posição)
    const palavrasNome = normalizar(p.name).split(/\s+/).filter(w => w.length >= 1);

    // Tokens de tags expandidos (usados para eligibilidade por características)
    const tagNorms = [
      ...(p.tags ?? []),
      ...(p.wordKeys ?? []),
      ...(p.searchIndex ?? []),
    ].flatMap((t) => expandirTag(t));

    /**
     * Avalia uma palavra de busca contra nome (posição) e tags (características).
     *
     * Nome — prioridade por posição:
     *   posição 0 → 50pts | posição 1 → 40pts | posição 2 → 30pts | posição 3+ → 20pts
     *
     * Tags — fallback quando o termo não está no nome:
     *   match exato → 10pts | alias → 6pts | prefixo → 4pts
     *
     * Sem match em nenhum dos dois → coberto=false (produto eliminado)
     */
    const avaliarPalavra = (w: string): { pts: number; coberto: boolean } => {
      const formas = [w, ...singularizar(w)];

      // 1. Verifica posição no nome (mais relevante)
      for (const forma of formas) {
        for (let i = 0; i < palavrasNome.length; i++) {
          if (palavrasNome[i] === forma || palavrasNome[i].startsWith(forma)) {
            const pts = PTS_NOME_POR_POSICAO[Math.min(i, PTS_NOME_POR_POSICAO.length - 1)];
            return { pts, coberto: true };
          }
        }
      }

      // 2. Verifica tags (marca, embalagem, características)
      for (const forma of formas) {
        for (const tagNorm of tagNorms) {
          if (tagNorm === forma) return { pts: 10, coberto: true };
        }
      }

      // Alias (ex: "caixinha" → #tetrapak)
      for (const forma of formas) {
        const aliases = ALIASES_BUSCA[forma] ?? [];
        if (aliases.length > 0) {
          for (const tagNorm of tagNorms) {
            if (aliases.some((alias) => normalizar(alias) === tagNorm)) {
              return { pts: 6, coberto: true };
            }
          }
        }
      }

      // Prefixo em tag (ex: "saboriz" → #saborizado)
      for (const forma of formas) {
        if (forma.length >= 4) {
          for (const tagNorm of tagNorms) {
            if (tagNorm.startsWith(forma)) return { pts: 4, coberto: true };
          }
        }
      }

      return { pts: 0, coberto: false };
    };

    let score = 0;
    let palavrasCobertas = 0;

    for (const w of palavrasBase) {
      const { pts, coberto } = avaliarPalavra(w);
      score += pts;
      if (coberto) palavrasCobertas++;
    }

    // Bônus: todas as palavras cobertas (nome ou tags)
    if (palavrasCobertas === palavrasBase.length) score += 25;

    // Produto só aparece se CADA palavra da busca for coberta (nome ou tag)
    if (palavrasCobertas < palavrasBase.length) {
      return { produto: p, score: 0 };
    }

    return { produto: p, score };
  }).filter(({ score }) => score > 0);

  return comScore
    .sort((a, b) => {
      const diff = b.score - a.score;
      if (diff !== 0) return diff;
      return (b.produto.stock ?? 0) - (a.produto.stock ?? 0);
    })
    .map(({ produto }) => produto)
    .slice(0, 20);
}

export function filtrarProdutosWordKeys(texto: string, produtos: Produto[]): Produto[] {
  // Usa a mesma lógica de filtrarProdutos (tags + wordKeys + searchIndex)
  return filtrarProdutos(texto, produtos);
}

export function selecionarCardsPorTermos(termos: string[], candidatos: Produto[], limite: number): Produto[] {
  const selecionados: Produto[] = [];
  const ids = new Set<string>();
  const termosUnicos = Array.from(new Set(termos));

  const combinaTermo = (p: Produto, termo: string) => {
    const tokens = [...(p.tags ?? []), ...(p.wordKeys ?? []), ...(p.searchIndex ?? [])].flatMap(expandirTag);
    return tokens.some((t) => t === termo || t.startsWith(termo));
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

export function combinarProdutosFoco(prioritarios: Produto[], catalogo: Produto[], limite = 20): Produto[] {
  const resultado: Produto[] = [];
  const ids = new Set<string>();

  // Adiciona prioritários em ordem de score (determinístico)
  for (const p of prioritarios) {
    if (resultado.length >= limite) break;
    if (ids.has(p.id)) continue;
    ids.add(p.id);
    resultado.push(p);
  }
  
  if (resultado.length >= limite) return resultado;

  // Ordenação determinística por ID para evitar variação na ordem
  const categoriasJaInseridas = new Map<string, number>(); // pista: quantos já inserimos dessa categoria
  const catalogoOrdenado = [...catalogo].sort((a, b) => a.id.localeCompare(b.id));

  for (const p of catalogoOrdenado) {
    if (resultado.length >= limite) break;
    if (ids.has(p.id)) continue;
    
    const cat = p.categoryId || p.category;
    // Só insere 1 produto por categoria para diversidade
    if (categoriasJaInseridas.has(cat)) continue;
    
    ids.add(p.id);
    resultado.push(p);
    categoriasJaInseridas.set(cat, 1);
  }

  // Se ainda não bateu o limite, preenche com resto (ordenado)
  for (const p of catalogoOrdenado) {
    if (resultado.length >= limite) break;
    if (ids.has(p.id)) continue;
    ids.add(p.id);
    resultado.push(p);
  }

  return resultado;
}

// ── Tradução de abreviações em nomes de produto ────────────────────────────

const ABREVIACOES: Record<string, string> = {
  VD:   "Vidro",
  UN:   "Un.",
  CX:   "Cx.",
  PCT:  "Pct.",
  SC:   "Saco",
  FD:   "Fardo",
  BJ:   "Bisnaga",
  TP:   "Tipo",
  INT:  "Integral",
  DESG: "Desnatado",
  SEMI: "Semidesnatado",
  PAST: "Pasteurizado",
  COMP: "Composto",
  CONC: "Concentrado",
};

/** Substitui abreviações conhecidas em nomes de produto (token exato, maiúsculo). */
export function traduzirAbreviacoes(nome: string): string {
  return nome.replace(/\b([A-Z]{2,5})\b/g, (match) => ABREVIACOES[match] ?? match);
}

// ── Correção ortográfica por distância de edição ────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev.splice(0, prev.length, ...curr);
  }
  return curr[n];
}

/**
 * Tenta corrigir uma palavra isolada comparando com tokens de tags do catálogo.
 * Retorna o token mais próximo ou null se não encontrar correspondência aceitável.
 */
export function sugerirCorrecaoOrtografica(termo: string, catalogo: Produto[]): string | null {
  const termoN = normalizar(termo);
  if (termoN.length < 4) return null;

  // Vocabulário = palavras de nomes + tokens de tags (ambas são fontes de eligibilidade)
  const vocab = new Set<string>();
  for (const p of catalogo) {
    // Palavras do nome
    normalizar(p.name).split(/\s+/).forEach(w => { if (w.length >= 3) vocab.add(w); });
    // Tokens de tags
    for (const token of [
      ...(p.tags ?? []),
      ...(p.wordKeys ?? []),
      ...(p.searchIndex ?? []),
    ].flatMap(expandirTag)) {
      if (token.length >= 3) vocab.add(token);
    }
  }

  const maxDist = termoN.length <= 5 ? 1 : termoN.length <= 8 ? 2 : 3;
  let melhor: string | null = null;
  let menorDist = Infinity;

  for (const palavra of vocab) {
    if (Math.abs(palavra.length - termoN.length) > maxDist) continue;
    const dist = levenshtein(termoN, palavra);
    if (dist > 0 && dist < menorDist && dist <= maxDist) {
      menorDist = dist;
      melhor = palavra;
    }
  }

  return melhor;
}

/**
 * Corrige o texto de busca palavra por palavra antes da busca.
 * Palavras que já têm match exato em alguma tag são mantidas.
 * Palavras sem match passam pela correção ortográfica.
 * Retorna o texto corrigido (ou o original se nada mudou).
 */
export function corrigirTextoBusca(texto: string, catalogo: Produto[]): string {
  const palavras = extrairPalavrasBaseBusca(texto);
  if (palavras.length === 0) return texto;

  // Vocabulário = palavras de nomes + tokens de tags (ambas são fontes de eligibilidade)
  const vocab = new Set<string>();
  for (const p of catalogo) {
    normalizar(p.name).split(/\s+/).forEach(w => { if (w.length >= 3) vocab.add(w); });
    for (const token of [
      ...(p.tags ?? []),
      ...(p.wordKeys ?? []),
      ...(p.searchIndex ?? []),
    ].flatMap(expandirTag)) {
      if (token.length >= 3) vocab.add(token);
    }
  }

  const corrigidas = palavras.map((w) => {
    // Já tem match direto ou via singular → mantém
    if (vocab.has(w) || singularizar(w).some((s) => vocab.has(s))) return w;
    // Tenta correção por distância de edição
    const maxDist = w.length <= 5 ? 1 : w.length <= 8 ? 2 : 3;
    let melhor: string | null = null;
    let menorDist = Infinity;
    for (const token of vocab) {
      if (Math.abs(token.length - w.length) > maxDist) continue;
      const dist = levenshtein(w, token);
      if (dist > 0 && dist < menorDist && dist <= maxDist) {
        menorDist = dist;
        melhor = token;
      }
    }
    return melhor ?? w;
  });

  const textoCorigido = corrigidas.join(" ");
  return textoCorigido !== palavras.join(" ") ? textoCorigido : texto;
}

// ── Verificação de cobertura completa ───────────────────────────────────────

/**
 * Retorna true se o produto cobre TODAS as palavras da busca via tags ou aliases.
 */
export function produtoCobreTermos(produto: Produto, palavras: string[]): boolean {
  const tokens = tokensTagsProduto([
    ...(produto.tags ?? []),
    ...(produto.wordKeys ?? []),
    ...(produto.searchIndex ?? []),
  ]);

  const cobre = (w: string): boolean => {
    if (tokens.some((t) => t === w || t.startsWith(w))) return true;
    return (ALIASES_BUSCA[w] ?? []).some((alias) => {
      const aN = normalizar(alias);
      return tokens.some((t) => t === aN || t.startsWith(aN));
    });
  };

  return palavras.every(cobre);
}

// ── Detecção de marca desconhecida ──────────────────────────────────────────

/**
 * Extrai todas as marcas reconhecidas do catálogo a partir das tags.
 * Uma tag é considerada marca se aparecer em produtos de pelo menos 2 categorias
 * distintas OU se for token de tag que não aparece em nenhum nome/subcategoria/categoria
 * como palavra de produto (ou seja, é exclusivamente uma marca).
 */
export function extrairMarcasDoCatalogo(catalogo: Produto[]): string[] {
  // Mapa: token → Set de categorias onde aparece
  const tokenCats = new Map<string, Set<string>>();
  // Tokens que aparecem em nome/subcategoria/categoria (são descritores, não marcas)
  const tokensDescritivos = new Set<string>();

  for (const p of catalogo) {
    const catKey = normalizar(p.category);
    // Coleta tokens descritivos do nome/cat/subcat
    for (const fonte of [p.name, p.category, p.subcategory]) {
      normalizar(fonte || "").split(/\s+/).forEach((w) => {
        if (w.length >= 3) tokensDescritivos.add(w);
      });
    }
    // Coleta tokens de tags e associa às categorias
    for (const tag of p.tags ?? []) {
      for (const token of expandirTag(tag)) {
        if (token.length < 3 || /^\d+$/.test(token)) continue;
        if (!tokenCats.has(token)) tokenCats.set(token, new Set());
        tokenCats.get(token)!.add(catKey);
      }
    }
  }

  const marcas: string[] = [];
  for (const [token, cats] of tokenCats) {
    // É marca se aparece em múltiplas categorias OU se não é um descritor de produto
    const isDescritor = tokensDescritivos.has(token);
    if (!isDescritor || cats.size >= 2) {
      // Formata para exibição: capitaliza primeiro caractere
      marcas.push(token.charAt(0).toUpperCase() + token.slice(1));
    }
  }

  return Array.from(new Set(marcas)).sort();
}

/**
 * Detecta se o texto contém uma marca desconhecida no catálogo.
 * Retorna { marcaSuspeita, termoProduto } se detectado, ou null caso contrário.
 *
 * Lógica: extrai palavras da busca; a busca completa retorna 0 resultados;
 * alguma palavra não aparece em nenhum produto (nem nome, nem tag) → marca desconhecida.
 */
export function detectarMarcaDesconhecida(
  texto: string,
  catalogo: Produto[]
): { marcaSuspeita: string; termoProduto: string } | null {
  const palavras = extrairPalavrasBaseBusca(texto);
  if (palavras.length < 2) return null;

  // Coleta todos os tokens presentes no catálogo (nome, subcat, cat, tags)
  const tokensConhecidos = new Set<string>();
  for (const p of catalogo) {
    for (const fonte of [p.name, p.category, p.subcategory, p.description || ""]) {
      normalizar(fonte).split(/\s+/).forEach((w) => { if (w.length >= 2) tokensConhecidos.add(w); });
    }
    for (const tag of p.tags ?? []) {
      expandirTag(tag).forEach((t) => tokensConhecidos.add(t));
    }
  }

  // Palavra que não existe em lugar nenhum do catálogo → marca desconhecida
  const ehQuantidade = (w: string) => /^\d+\s*(?:kg|g|ml|l|lt|un|pc|pct|gr)$/.test(w);
  const palavrasDesconhecidas = palavras.filter(
    (w) => !ehQuantidade(w) && !tokensConhecidos.has(w)
  );

  if (palavrasDesconhecidas.length === 0) return null;

  // A marca suspeita é a palavra desconhecida; o produto é o restante
  const marcaSuspeita = palavrasDesconhecidas[0];
  const termoProduto = palavras.filter((w) => w !== marcaSuspeita).join(" ");

  return termoProduto ? { marcaSuspeita, termoProduto } : null;
}

// ── Busca de alternativas ────────────────────────────────────────────────────

export function buscarAlternativasPorTermo(termo: string, catalogo: Produto[], excluirId?: string): Produto[] {
  const palavras = extrairPalavrasBaseBusca(termo);
  const termos = palavras.length > 0 ? palavras : [normalizar(termo)];
  return catalogo
    .filter((p) => {
      if (excluirId && p.id === excluirId) return false;
      const tokens = [...(p.tags ?? []), ...(p.wordKeys ?? []), ...(p.searchIndex ?? [])].flatMap(expandirTag);
      return termos.some((t) => t.length >= 2 && tokens.some((tk) => tk === t || tk.startsWith(t)));
    })
    .slice(0, 6);
}

// ── Busca por Categoria ─────────────────────────────────────────────────────

/**
 * Embaralha um array de forma aleatória (Fisher-Yates shuffle).
 * Usado para randomizar a exibição de produtos de uma categoria.
 */
export function embaralharArray<T>(arr: T[]): T[] {
  const resultado = [...arr];
  for (let i = resultado.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [resultado[i], resultado[j]] = [resultado[j], resultado[i]];
  }
  return resultado;
}

/**
 * Detecta se o cliente está buscando por uma categoria.
 * Retorna o nome da categoria normalizado, ou null.
 * 
 * Exemplos:
 * - "mercearia" → "mercearia"
 * - "produtos de mercearia" → "mercearia"
 * - "me mostra mercearia" → "mercearia"
 * - "bebidas" → "bebidas"
 */
export function detectarBuscaPorCategoria(texto: string, catalogo: Produto[]): string | null {
  const t = normalizar(texto);
  
  // Extrai todas as categorias únicas do catálogo
  const categorias = new Set(catalogo.map(p => normalizar(p.category)));
  
  // Para cada categoria, verifica se aparece no texto
  for (const cat of categorias) {
    if (cat.length >= 3 && t.includes(cat)) {
      // Retorna a categoria original (não normalizada) para exibição
      const categoriaOriginal = catalogo.find(p => normalizar(p.category) === cat)?.category;
      if (categoriaOriginal) return categoriaOriginal;
    }
  }
  
  return null;
}

/**
 * Busca produtos de uma categoria específica, em ordem aleatória.
 * Retorna TODOS os produtos da categoria embaralhados.
 * 
 * Usado com paginação: show 6, then 6 more, etc.
 */
export function buscarProdutosPorCategoria(categoria: string, catalogo: Produto[]): Produto[] {
  const categoriaNorm = normalizar(categoria);
  
  const produtosDaCategoria = catalogo.filter(p => 
    normalizar(p.category) === categoriaNorm
  );
  
  // Embaralha para mostrar em ordem aleatória
  return embaralharArray(produtosDaCategoria);
}
