import type { Produto } from "@/lib/buildSystemPrompt";

/** Remove acentos e converte para minúsculas para comparação */
export function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Expande uma tag "#TioDito" em tokens normalizados ["tio", "dito"].
 * Remove o # inicial e divide por camelCase, números e hífens.
 */
/**
 * Normaliza uma tag simples: remove o # e converte para minúsculas sem acento.
 * Tags são palavras únicas (#gelo, #saborizado, #750ml, #garrafa).
 * Retorna array com o único token normalizado.
 */
export function expandirTag(tag: string): string[] {
  return [normalizar(tag.replace(/^#/, ""))];
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

export function filtrarProdutos(texto: string, produtos: Produto[]): Produto[] {
  const palavrasBase = extrairPalavrasBaseBusca(texto);
  if (palavrasBase.length === 0) return [];

  const comScore = produtos.map((p) => {
    const tags = p.tags ?? [];
    if (tags.length === 0) return { produto: p, score: 0 };

    // Normaliza todas as tags do produto uma única vez
    const tagNorms = tags.map((t) => normalizar(t.replace(/^#/, "")));

    /**
     * Avalia uma palavra de busca contra as tags do produto.
     * Tags são palavras únicas (#gelo, #saborizado, #750ml).
     *
     * - coberto=true + 50pts : tag exata  (ex: "gelo" vs #gelo)
     * - coberto=true + 15pts : alias direto (ex: "caixinha" vs #tetrapak)
     * - coberto=true + 10pts : prefixo (ex: "saboriz" vs #saborizado)
     * - coberto=false        : sem match
     */
    const avaliarPalavra = (w: string): { pts: number; coberto: boolean } => {
      for (const tagNorm of tagNorms) {
        // Exato
        if (tagNorm === w) return { pts: 50, coberto: true };
      }

      // Alias direto (ex: "caixinha" → busca por "tetrapak","caixa" nas tags)
      const aliases = ALIASES_BUSCA[w] ?? [];
      if (aliases.length > 0) {
        for (const tagNorm of tagNorms) {
          if (aliases.some((alias) => normalizar(alias) === tagNorm)) {
            return { pts: 15, coberto: true };
          }
        }
      }

      // Prefixo (ex: "saboriz" encontra #saborizado)
      if (w.length >= 4) {
        for (const tagNorm of tagNorms) {
          if (tagNorm.startsWith(w)) return { pts: 10, coberto: true };
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

    // Bônus: todas as palavras têm cobertura exata
    if (palavrasCobertas === palavrasBase.length) score += 25;

    // Regra principal: produto só aparece se tiver tag dedicada para CADA palavra da busca.
    // "leite" → precisa de #Leite (sub-token em #SaborLeite não conta).
    // "leite caixinha" → precisa de #Leite E #TetraPak/#Caixinha.
    if (palavrasCobertas < palavrasBase.length) {
      return { produto: p, score: 0 };
    }

    return { produto: p, score };
  }).filter(({ score }) => score > 0);

  return comScore
    .sort((a, b) => b.score - a.score)
    .map(({ produto }) => produto)
    .slice(0, 20);
}

export function filtrarProdutosWordKeys(texto: string, produtos: Produto[]): Produto[] {
  // Usa a mesma lógica de filtrarProdutos (somente tags)
  return filtrarProdutos(texto, produtos);
}

export function selecionarCardsPorTermos(termos: string[], candidatos: Produto[], limite: number): Produto[] {
  const selecionados: Produto[] = [];
  const ids = new Set<string>();
  const termosUnicos = Array.from(new Set(termos));

  const combinaTermo = (p: Produto, termo: string) => {
    const nome = normalizar(p.name);
    const sub  = normalizar(p.subcategory);
    const cat  = normalizar(p.category);
    const desc = normalizar(p.description || "");
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
 * Tenta corrigir um termo sem resultados comparando com palavras do catálogo.
 * Retorna a palavra mais próxima se a distância de edição for aceitável,
 * ou null se não encontrar boa correspondência.
 */
export function sugerirCorrecaoOrtografica(termo: string, catalogo: Produto[]): string | null {
  const termoN = normalizar(termo);
  if (termoN.length < 4) return null;

  // Coleta palavras únicas do catálogo (nome, categoria, subcategoria)
  const palavras = new Set<string>();
  for (const p of catalogo) {
    for (const fonte of [p.name, p.category, p.subcategory]) {
      normalizar(fonte || "").split(/\s+/).forEach((w) => {
        if (w.length >= 3) palavras.add(w);
      });
    }
  }

  // Distância máxima permitida depende do tamanho do termo
  const maxDist = termoN.length <= 5 ? 1 : termoN.length <= 8 ? 2 : 3;

  let melhor: string | null = null;
  let menorDist = Infinity;

  for (const palavra of palavras) {
    if (Math.abs(palavra.length - termoN.length) > maxDist) continue;
    const dist = levenshtein(termoN, palavra);
    if (dist > 0 && dist < menorDist && dist <= maxDist) {
      menorDist = dist;
      melhor = palavra;
    }
  }

  return melhor;
}

// ── Verificação de cobertura completa ───────────────────────────────────────

/**
 * Retorna true se o produto cobre TODAS as palavras da busca via tags ou aliases.
 */
export function produtoCobreTermos(produto: Produto, palavras: string[]): boolean {
  const tagTokens = produto.tags ? tokensTagsProduto(produto.tags) : [];

  const cobre = (w: string): boolean => {
    if (tagTokens.some((t) => t === w || t.startsWith(w))) return true;
    return (ALIASES_BUSCA[w] ?? []).some((alias) => {
      const aN = normalizar(alias);
      return tagTokens.some((t) => t === aN || t.startsWith(aN));
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
      const alvo = normalizar(`${p.name} ${p.subcategory} ${p.category} ${p.description || ""}`);
      return termos.some((t) => t.length >= 2 && alvo.includes(t));
    })
    .slice(0, 6);
}
