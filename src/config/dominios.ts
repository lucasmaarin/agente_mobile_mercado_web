// Mapeamento: domínio do cliente → slug do estabelecimento
// Adicione uma linha por cliente e redeploy no Render
export const DOMAIN_SLUGS: Record<string, string> = {
  // 'royal.com.br':            'royal',
  // 'zerograu.com.br':         'zerograu',
  // 'padaria-center.com.br':   'padaria-center',
  'https://www.uaumart.com.br': 'q0ipiusmpeq3phbmyfwy', // UAU Mart
  'vidal': 'xaxmop6awerbbab0guvu',
  '.2': 'jqqjhtcc2zw1tuzmqzgf', // Zero Grau
};

// Slugs autorizados a carregar o agente
// 'estabelecimento-teste' é sempre permitido (ambiente de demonstração)
export const SLUGS_AUTORIZADOS: ReadonlySet<string> = new Set([
  'estabelecimento-teste',
  ...Object.values(DOMAIN_SLUGS),
]);