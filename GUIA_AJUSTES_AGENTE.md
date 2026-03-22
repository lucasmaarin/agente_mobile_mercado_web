# Guia de Ajustes do Agente de Compras

Este documento explica onde e como fazer os ajustes mais comuns no agente, sem precisar de ajuda externa.

---

## 1. Regras de comportamento da IA (`buildSystemPrompt.ts`)

**Arquivo:** `src/lib/buildSystemPrompt.ts`

Este arquivo monta o "manual de instruções" que a IA recebe a cada mensagem. Tudo que a IA faz ou fala pode ser controlado aqui.

### Como adicionar uma regra de comportamento

Dentro do bloco `MODO: navegação` (procure por `━━ SITUAÇÕES COMUNS ━━`), adicione uma linha no padrão:

```
• [situação] → [o que a IA deve fazer]
```

**Exemplos reais já existentes:**
```
• Pedido mínimo → o valor mínimo para realizar um pedido é R$ 60,00. Se o cliente perguntar, informe este valor.
• Formas de pagamento → informe: "Aceitamos: Pix, Dinheiro, Cartão..."
• Cumprimento puro → responda brevemente e pergunte o que precisa
```

**Para alterar o pedido mínimo**, basta mudar o número na linha:
```ts
• Pedido mínimo → o valor mínimo para realizar um pedido é R$ 60,00.
```

### O que NÃO mudar
- As tags `[SHOW:ID]`, `[ADD:ID:QTD]`, `[START_CHECKOUT]` — são o sistema de ações e não podem ser alteradas.
- Os blocos dos outros estados (`COLLECTING_NAME`, `COLLECTING_PAYMENT`, etc.) — controlam o fluxo de checkout.

---

## 2. Filtro de produtos (`page.tsx`)

**Arquivo:** `src/app/[slug]/page.tsx`

Existem dois sistemas de busca. Ambos precisam receber o mesmo ajuste quando você fizer uma mudança:

| Função | Quando é usada |
|---|---|
| `filtrarProdutos` | Busca padrão (wordKeys desligado) |
| `filtrarProdutosWordKeys` | Busca por índice do Firestore (wordKeys ligado) |

### Sistema de pontuação (score)

Cada produto recebe pontos conforme o quanto bate com o que o cliente pediu. Quem tem mais pontos aparece primeiro.

| Situação | Pontos |
|---|---|
| Frase completa aparece no nome do produto | +45 |
| Todas as palavras aparecem no produto | +20 |
| Palavra aparece na subcategoria (exata) | +12 |
| Palavra aparece no nome | +6 |
| Produto começa com o termo buscado | +15 (bônus) |
| Termo aparece como sabor ("ao leite", "com leite") mas não é o produto principal | -18 (penalidade) |

### Como adicionar um bônus para um produto específico

Exemplo: quero que "macarrão parafuso" apareça primeiro quando o cliente pede "parafuso":

```ts
if (palavrasBase.includes('parafuso') && palavrasBase.includes('macarrao')) {
  if (nomeN.includes('parafuso')) score += 24;
}
```

Adicione dentro do bloco de `comScore = produtos.map(...)`, antes da linha `return { produto: p, score };`.
Faça isso em **ambas** as funções: `filtrarProdutos` e `filtrarProdutosWordKeys`.

### Como penalizar um produto que aparece errado

Exemplo: "leite em pó" não deve aparecer quando o cliente pede "leite condensado":

```ts
if (temLeite && palavrasBase.includes('condensado')) {
  if (nomeN.includes('po') || nomeN.includes('instantaneo')) score -= 20;
}
```

---

## 3. Palavras ignoradas na busca (stopwords)

**Arquivo:** `src/app/[slug]/page.tsx`
**Procure por:** `const STOPWORDS_BUSCA = new Set([`

Palavras que ficam nessa lista são ignoradas antes de pesquisar produtos.

```ts
const STOPWORDS_BUSCA = new Set([
  'de', 'da', 'do', 'para', 'com', 'sem',
  'um', 'uma', 'uns', 'umas',
  'me', 'pra', 'quero', 'preciso',
  // adicione aqui palavras que não devem ser buscadas
]);
```

**Quando adicionar uma palavra:**
- Se ela aparece em mensagens normais mas não é um produto (ex: "só", "apenas", "mais")
- Se ela causa buscas erradas (ex: "boa" e "noite" de "boa noite" virando busca de produto)

**Cuidado:** não adicione palavras que também são produtos (ex: "sal", "mel").

---

## 4. Chips de resposta rápida (botões)

**Arquivo:** `src/app/[slug]/page.tsx`
**Procure por:** `getQuickReplies`

Os chips que aparecem em cada situação são definidos aqui:

```ts
const getQuickReplies = (fs: FlowState, carrinhoLen: number): string[] => {
  switch (fs) {
    case FLOW_STATES.BROWSING:
      return carrinhoLen > 0 ? ['Finalizar pedido 🛒', 'Continuar comprando'] : [];
    // ...
  }
};
```

Para mudar o texto de um botão, edite a string dentro do array.
Para adicionar um botão, inclua uma nova string no array.

**Os chips também aparecem por mensagem** — quando o agente responde com produtos, os chips são passados como terceiro argumento de `salvarRespostaLocal`:

```ts
await salvarRespostaLocal(
  "Texto da mensagem",
  [produtos],
  ["Finalizar pedido 🛒", "Continuar comprando"]  // ← chips desta mensagem
);
```

---

## 5. Detecção de intenções do cliente

**Arquivo:** `src/app/[slug]/page.tsx`
**Procure por:** `function eh` (todas começam com `eh`)

| Função | O que detecta |
|---|---|
| `ehIntencaoCheckout` | "finalizar", "pagar", "fechar pedido" |
| `ehAcaoContinuarComprando` | "continuar comprando", "continuar" |
| `ehCancelamento` | "cancelar", "desistir", "não quero" |

### Como adicionar uma nova frase reconhecida

Exemplo: quero que "quero pagar" também abra o checkout:

```ts
function ehIntencaoCheckout(texto: string): boolean {
  const t = normalizar(texto).replace(/[.!?]/g, "").trim();
  return (
    t.includes("finalizar") ||
    t.includes("pagar") ||        // ← já existe
    t.includes("quero pagar") ||  // ← adicione aqui
    t.includes("fechar pedido")
  );
}
```

---

## 6. Mensagens automáticas do agente (respostas locais)

**Arquivo:** `src/app/[slug]/page.tsx`
**Procure por:** `salvarRespostaLocal`

Quando o agente responde sem usar a IA (fluxo local), usa essa função:

```ts
await salvarRespostaLocal(
  "Texto que aparece no balão de mensagem",
  [produtos],           // opcional: array de produtos para mostrar cards
  ["Chip 1", "Chip 2"] // opcional: botões de resposta rápida
);
```

Para mudar uma mensagem automática, localize o texto entre aspas e edite diretamente.

**Exemplo — mudar a mensagem de boas-vindas ao retomar compra:**
```ts
// Antes:
"Tudo certo! O que mais posso separar para você? 😊"

// Depois (edite o texto):
"Claro! O que mais precisa? 😊"
```

---

## 7. Checklist para testar um ajuste

Após qualquer mudança, teste estes cenários básicos no chat:

- [ ] Saudação simples: "Boa noite" → deve perguntar o que precisa, **não** buscar produtos
- [ ] Produto simples: "Quero um leite" → deve mostrar apenas produtos de leite
- [ ] Produto composto: "Leite condensado" → deve mostrar leite condensado, não chocolates ao leite
- [ ] Lista: "Arroz e feijão" → deve mostrar um carrossel por item
- [ ] Finalizar: clicar em "Finalizar pedido 🛒" → deve abrir o checkout
- [ ] Continuar: clicar em "Continuar comprando" → deve perguntar o que mais precisa, sem mostrar produtos

---

## Resumo rápido

| Problema | Onde resolver |
|---|---|
| IA fala algo errado / não sabe de uma regra | `buildSystemPrompt.ts` → seção `SITUAÇÕES COMUNS` |
| Produto errado aparece na busca | `page.tsx` → `filtrarProdutos` + `filtrarProdutosWordKeys` (ajuste o score) |
| Palavra do cliente vira busca de produto | `page.tsx` → `STOPWORDS_BUSCA` |
| Botão com texto errado | `page.tsx` → `getQuickReplies` ou `salvarRespostaLocal` |
| Mensagem automática com texto errado | `page.tsx` → procure o texto entre aspas e edite |
| IA não reconhece uma frase do cliente | `page.tsx` → funções `ehIntencao*` |
