// Mapeamento: domínio do cliente → slug do estabelecimento
// Adicione uma linha por cliente e redeploy no Render
export const DOMAIN_SLUGS: Record<string, string> = {
  // 'royal.com.br':            'royal',
  // 'zerograu.com.br':         'zerograu',
  // 'padaria-center.com.br':   'padaria-center',
  'https://www.uaumart.com.br': 'q0IPIusmpEq3pHbMyfWY', // UAU Mart
  'vidal': 'XAXMOP6aweRbBAb0gUvU',
  'zero grau': 'jQQjHTCc2zW1tuZMQzGF',
};

// Mapa de slug em minúsculo → ID real do Firestore (com casing correto)
// Usado para resolver URLs que chegam em lowercase
export const SLUG_PARA_COMPANY_ID: Record<string, string> = Object.fromEntries(
  Object.values(DOMAIN_SLUGS).map(id => [id.toLowerCase(), id])
);
