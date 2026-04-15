import type { Produto } from "@/lib/buildSystemPrompt";

/** Remove acentos e converte para minúsculas para comparação */
export function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Expande uma tag "#TioDito" em tokens normalizados ["tio", "dito"].
 * Remove o # inicial e divide por camelCase, números e hífens.
 */
export function expandirTag(tag: string): string[] {
  const semHash = tag.replace(/^#/, "");
  // Token completo normalizado (ex: "1Kg" → "1kg", "CarneMoida" → "carnemoida")
  const tokenCompleto = normalizar(semHash);
  // Divide camelCase e dígito-letra: "TioDito" → ["tio","dito"], "1Kg" → ["1","kg"]
  const partes = semHash
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g,  "$1 $2")
    .replace(/(\d)([A-Za-z])/g,  "$1 $2")
    .split(/[\s\-_]+/)
    .map(normalizar)
    .filter((t) => t.length >= 1);
  // Retorna partes + token completo (para match de "1kg" contra #1Kg)
  return Array.from(new Set([...partes, tokenCompleto]));
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
  // embalagens → tokens de tag equivalentes
  caixinha: ["tetrapak"],
  caixa:    ["tetrapak"],
  garrafa:  ["garrafa", "pet", "vidro"],
  lata:     ["lata", "aluminio"],
  saquinho: ["saquinho", "sachet"],
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

  const palavras = expandirPalavrasBusca(palavrasBase);
  const fraseBase = palavrasBase.join(" ");

  const comScore = produtos.map((p) => {
    const nomeN   = normalizar(p.name);
    const subcatN = normalizar(p.subcategory);
    const catN    = normalizar(p.category);
    const descN   = normalizar(p.description || "");
    const alvo    = `${nomeN} ${subcatN} ${catN} ${descN}`;
    const tagTokens = p.tags ? tokensTagsProduto(p.tags) : [];

    let score = 0;

    // ── Tags (campo mais preciso — pontuação mais alta) ──────────────────
    if (tagTokens.length > 0) {
      const cobreTagPalavra = (w: string) => {
        if (tagTokens.some((t) => t === w || t.startsWith(w))) return true;
        // verifica aliases (ex: "caixinha" → "tetrapak")
        return (ALIASES_BUSCA[w] ?? []).some((alias) => {
          const aN = normalizar(alias);
          return tagTokens.some((t) => t === aN || t.startsWith(aN));
        });
      };
      for (const w of palavrasBase) {
        if (tagTokens.includes(w))      score += 22;
        else if (cobreTagPalavra(w))    score += 16;
      }
      const todosNasTags = palavrasBase.length > 0 && palavrasBase.every(cobreTagPalavra);
      if (todosNasTags) score += 25;
    }

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

    const temLeite = palavrasBase.includes("leite");
    const textoN = normalizar(texto);
    const temCaixinha = textoN.includes("caixinha") || textoN.includes("caixa");
    if (temLeite && temCaixinha) {
      if (nomeN.includes("leite")) {
        const ehExcluido =
          nomeN.includes(" po") || nomeN.includes("po ") || nomeN.includes("em po") ||
          nomeN.includes("instantaneo") || nomeN.includes("instantanea") ||
          nomeN.includes("condensado") || nomeN.includes("coco") ||
          nomeN.includes("colonia") || nomeN.includes("soja") ||
          nomeN.includes("aveia") || nomeN.includes("amendoa") ||
          descN.includes("leite em po") || descN.includes("leite condensado");
        if (ehExcluido) score -= 60;
        else score += 22;
      }
    }

    if (temLeite && palavrasBase.includes("po")) {
      const pareceLeitePo = nomeN.includes("leite") && (nomeN.includes("po") || nomeN.includes("instantaneo"));
      if (pareceLeitePo) score += 22;
    }

    if (temLeite && palavrasBase.includes("condensado")) {
      const pareceLeiteCondensado = nomeN.includes("leite") && nomeN.includes("condensado");
      if (pareceLeiteCondensado) score += 22;
      if (nomeN.includes("po") || nomeN.includes("instantaneo") || subcatN.includes("po")) score -= 20;
    }

    if (palavrasBase.includes("frango") && palavrasBase.includes("peito")) {
      if (nomeN.includes("frango") && (nomeN.includes("peito") || nomeN.includes("file"))) score += 24;
    }

    if (palavrasBase.includes("frango") && palavrasBase.includes("inteiro")) {
      if (nomeN.includes("frango") && nomeN.includes("inteiro")) score += 24;
    }

    if (palavrasBase.length > 0 && nomeN.startsWith(palavrasBase[0])) score += 15;

    for (const w of palavrasBase) {
      const apareceComoSabor = nomeN.includes("ao " + w) || nomeN.includes("c/ " + w) || nomeN.includes("com " + w);
      const apareceComoProduto = nomeN.startsWith(w) || subcatN.includes(w) || catN === w;
      if (apareceComoSabor && !apareceComoProduto) score -= 18;
    }

    // ── Penalidade: ração/pet food quando a busca não é de pet ───────────
    const termoPet = palavrasBase.some((w) =>
      ["racao", "raca", "pet", "cachorro", "gato", "cao", "felino", "canino"].includes(w)
    );
    const ehProdutoPet =
      catN.includes("racao") || catN.includes("pet") || catN.includes("animal") ||
      subcatN.includes("racao") || subcatN.includes("pet") || subcatN.includes("animal") ||
      nomeN.startsWith("racao") || nomeN.includes("whiskas") || nomeN.includes("pedigree") ||
      nomeN.includes("love dog") || nomeN.includes("premier") || nomeN.includes("golden");
    if (ehProdutoPet && !termoPet) score -= 80;

    return { produto: p, score };
  }).filter(({ score }) => score > 0);

  const garantidos = new Set<string>();

  /**
   * Verifica se uma tag específica cobre a palavra buscada.
   * Regra: apenas o PRIMEIRO token do composto é o identificador primário.
   * Ex: #CremeDeLeite → primeiro token "creme" → "leite" NÃO bate.
   * Para multi-palavra, exige que TODOS os termos apareçam como tokens consecutivos
   * (ex: busca "carne moida" bate em #CarneMoida porque "carne" e "moida" são tokens adjacentes).
   */
  const tagCobre = (tag: string, w: string): boolean => {
    const semHash = tag.replace(/^#/, "");
    const fullN   = normalizar(semHash); // ex: "cremedelite", "carnemoida"
    // 1. Token completo bate
    if (fullN === w || fullN.startsWith(w)) return true;
    // 2. Primeiro token do composto bate (identificador primário)
    const partes = semHash
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Za-z])(\d)/g, "$1 $2")
      .replace(/(\d)([A-Za-z])/g, "$1 $2")
      .split(/[\s\-_]+/)
      .map(normalizar)
      .filter((t) => t.length >= 1);
    if (partes.length > 0 && (partes[0] === w || partes[0].startsWith(w))) return true;
    // 3. Multi-palavra: APENAS se for um composto real (tokens consecutivos, não dispersos)
    // Ex: "carne moida" bate em "carnemoida" (partes = ["carne", "moida"]),
    // MAS NÃO bate em uma tag que tenha "carne" e "moida" separadas como #CarneBrancaComMoida
    // (partes = ["carne", "branca", "com", "moida"])
    if (palavrasBase.length > 1) {
      // Verifica se todos os termos aparecem como tokens CONSECUTIVOS
      const primeiroTermo = palavrasBase[0];
      let inicioIdx = -1;
      for (let i = 0; i < partes.length; i++) {
        if (partes[i] === primeiroTermo || partes[i].startsWith(primeiroTermo)) {
          inicioIdx = i;
          break;
        }
      }
      if (inicioIdx >= 0) {
        let todosConsecutivos = true;
        for (let i = 1; i < palavrasBase.length; i++) {
          const idx = inicioIdx + i;
          if (idx >= partes.length || !partes[idx].startsWith(palavrasBase[i])) {
            todosConsecutivos = false;
            break;
          }
        }
        if (todosConsecutivos) return true;
      }
    }
    return false;
  };

  // Verifica se um produto cobre uma palavra via texto, tags ou aliases de embalagem
  const cobrePalavra = (p: Produto, w: string): boolean => {
    const nomeN   = normalizar(p.name);
    const subcatN = normalizar(p.subcategory);
    const catN    = normalizar(p.category);
    const descN   = normalizar(p.description || "");
    if (nomeN.includes(w) || subcatN.includes(w) || catN.includes(w) || descN.includes(w)) return true;
    // Tags: usa regra de primeiro token para compostos
    if ((p.tags ?? []).some((tag) => tagCobre(tag, w))) return true;
    // Verifica aliases da palavra (ex: "caixinha" → "tetrapak")
    const aliasesDeW = ALIASES_BUSCA[w] ?? [];
    for (const alias of aliasesDeW) {
      const aN = normalizar(alias);
      if (nomeN.includes(aN) || subcatN.includes(aN) || catN.includes(aN) || descN.includes(aN)) return true;
      if ((p.tags ?? []).some((tag) => tagCobre(tag, aN))) return true;
    }
    return false;
  };

  // ── Fallback progressivo: tenta encontrar com TODOS os termos primeiro ──
  const ehQuantidade = (w: string) => /^\d+\s*(?:kg|g|ml|l|lt|un|pc|pct|gr)$/.test(w);
  const termosValidos = palavrasBase.filter((w) => !ehQuantidade(w));
  
  // Nível 1: Produtos que cobrem TODAS as palavras (e.g., leite + caixa)
  const withAll = comScore.filter(({ produto: p }) => 
    termosValidos.length > 0 && termosValidos.every((w) => cobrePalavra(p, w))
  );
  
  // Nível 2: Se não houver com todas, tenta com o termo principal
  const primaryTerm = termosValidos.length > 0 ? termosValidos[0] : palavrasBase[0];
  const withPrimary = withAll.length === 0 
    ? comScore.filter(({ produto: p }) => cobrePalavra(p, primaryTerm))
    : [];

  const melhorNivel = withAll.length > 0 ? withAll : (withPrimary.length > 0 ? withPrimary : comScore);

  melhorNivel
    .sort((a, b) => b.score - a.score)
    .forEach(({ produto: p }) => garantidos.add(p.id));

  const resultado: Produto[] = [];

  // Ordena por score (maior primeiro)
  const ordenados = comScore.sort((a, b) => b.score - a.score);
  
  // Prioriza produtos que cobrem todos os termos, depois apenas principal, depois tudo
  for (const { produto } of ordenados) {
    if (garantidos.has(produto.id)) resultado.push(produto);
  }

  // Só preenche com não-prioritários se não houve nenhum produto prioritário
  if (resultado.length === 0) {
    for (const { produto } of ordenados) {
      if (!garantidos.has(produto.id)) resultado.push(produto);
    }
  }

  return resultado.slice(0, 20);
}

export function filtrarProdutosWordKeys(texto: string, produtos: Produto[]): Produto[] {
  const palavrasBase = extrairPalavrasBaseBusca(texto);
  if (palavrasBase.length === 0) return [];

  const prefixos = palavrasBase.map((p) => p.toUpperCase());

  const comScore = produtos.map((p) => {
    const todosKeys = [...(p.wordKeys ?? []), ...(p.searchIndex ?? [])];
    const nomeN   = normalizar(p.name);
    const subcatN = normalizar(p.subcategory);
    const catN    = normalizar(p.category);
    const tagTokens = p.tags ? tokensTagsProduto(p.tags) : [];
    let score = 0;

    // ── Tags (pontuação mais alta — campo curado) ────────────────────────
    if (tagTokens.length > 0) {
      for (const w of palavrasBase) {
        if (tagTokens.includes(w))                        score += 22;
        else if (tagTokens.some((t) => t.startsWith(w))) score += 14;
      }
      const todosNasTags = palavrasBase.length > 0 && palavrasBase.every((w) =>
        tagTokens.some((t) => t === w || t.startsWith(w))
      );
      if (todosNasTags) score += 25;
    }

    for (const pref of prefixos) {
      if (todosKeys.some((k) => k === pref)) score += 15;
      else if (todosKeys.some((k) => k.startsWith(pref))) score += 8;
    }

    const todosPresentes = prefixos.every((pref) => todosKeys.some((k) => k.startsWith(pref)));
    if (todosPresentes && prefixos.length > 1) score += 20;

    if (palavrasBase.length > 0 && nomeN.startsWith(palavrasBase[0])) score += 15;

    for (const w of palavrasBase) {
      const apareceComoSabor = nomeN.includes("ao " + w) || nomeN.includes("c/ " + w) || nomeN.includes("com " + w);
      const apareceComoProduto = nomeN.startsWith(w) || subcatN.includes(w) || catN === w;
      if (apareceComoSabor && !apareceComoProduto) score -= 18;
    }

    return { produto: p, score };
  }).filter(({ score }) => score > 0);

  return comScore.sort((a, b) => b.score - a.score).map(({ produto }) => produto).slice(0, 20);
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

  const push = (p: Produto) => {
    if (resultado.length >= limite) return;
    if (ids.has(p.id)) return;
    ids.add(p.id);
    resultado.push(p);
  };

  prioritarios.forEach(push);
  if (resultado.length >= limite) return resultado;

  const categoriasPrioritarias = new Set(prioritarios.map((p) => p.categoryId || p.category));
  const categoriaJaInserida = new Set<string>();

  for (const p of catalogo) {
    if (resultado.length >= limite) break;
    if (ids.has(p.id)) continue;
    const cat = p.categoryId || p.category;
    if (categoriasPrioritarias.has(cat)) continue;
    if (categoriaJaInserida.has(cat)) continue;
    categoriaJaInserida.add(cat);
    push(p);
  }

  for (const p of catalogo) {
    if (resultado.length >= limite) break;
    push(p);
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
 * Retorna true se o produto cobre TODAS as palavras da busca
 * (via nome, categoria, subcategoria, descrição, tags ou aliases).
 */
export function produtoCobreTermos(produto: Produto, palavras: string[]): boolean {
  const nomeN   = normalizar(produto.name);
  const subcatN = normalizar(produto.subcategory);
  const catN    = normalizar(produto.category);
  const descN   = normalizar(produto.description || "");
  const tagTokens = produto.tags ? tokensTagsProduto(produto.tags) : [];

  const cobre = (w: string): boolean => {
    if (nomeN.includes(w) || subcatN.includes(w) || catN.includes(w) || descN.includes(w)) return true;
    if (tagTokens.some((t) => t === w || t.startsWith(w))) return true;
    return (ALIASES_BUSCA[w] ?? []).some((alias) => {
      const aN = normalizar(alias);
      return nomeN.includes(aN) || subcatN.includes(aN) || catN.includes(aN) || tagTokens.some((t) => t === aN || t.startsWith(aN));
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
