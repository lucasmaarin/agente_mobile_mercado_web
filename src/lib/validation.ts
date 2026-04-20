// lib/validation.ts - Utilitários de validação e sanitização

/**
 * Sanitiza uma string removendo caracteres perigosos (previne XSS)
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
}

/**
 * Valida número de telefone brasileiro
 * Aceita: +55 11 99999-9999 ou 11999999999
 * Retorna o número formatado com +55 ou null se inválido
 */
export function validatePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  // Remover o 55 se já existir no início
  let cleaned = digits.startsWith("55") ? digits.slice(2) : digits;
  // DDD (2 dígitos) + número (8 ou 9 dígitos)
  if (cleaned.length < 10 || cleaned.length > 11) return null;
  // DDD válido (11-99)
  const ddd = parseInt(cleaned.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  // Número com 8 dígitos (sem o 9): adiciona o 9 para celular brasileiro
  if (cleaned.length === 10) {
    cleaned = cleaned.slice(0, 2) + '9' + cleaned.slice(2);
  }
  return `+55${cleaned}`;
}

/**
 * Valida CPF brasileiro com dígitos verificadores
 * Retorna true se o CPF é válido
 */
export function validateCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  // Rejeitar CPFs com todos os dígitos iguais
  if (/^(\d)\1{10}$/.test(digits)) return false;

  // Validar primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(digits[9])) return false;

  // Validar segundo dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(digits[10])) return false;

  return true;
}

/**
 * Formata CPF para exibição: 000.000.000-00
 */
export function formatCPF(cpf: string): string {
  const digits = cpf.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/**
 * Valida CEP brasileiro (8 dígitos)
 */
export function validateCEP(cep: string): boolean {
  const digits = cep.replace(/\D/g, "");
  return digits.length === 8;
}

/**
 * Valida código de verificação (6 dígitos numéricos)
 */
export function validateVerificationCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * Limita o tamanho de um input de texto
 */
export function limitLength(input: string, maxLength: number): string {
  return input.slice(0, maxLength);
}
