type WhatsappAuthPayload = Record<string, unknown>;

function getAuthApiBaseUrl() {
  const baseUrl = process.env.AUTH_API_URL?.trim();
  if (!baseUrl) {
    throw new Error("AUTH_API_URL nao configurado");
  }
  return baseUrl.replace(/\/+$/, "");
}

function buildAuthApiUrl(path: string) {
  const baseUrl = getAuthApiBaseUrl();
  if (baseUrl.endsWith(path)) return baseUrl;
  if (baseUrl.endsWith("/auth/whatsapp")) return `${baseUrl}${path.replace("/auth", "")}`;
  return `${baseUrl}${path}`;
}

export function isWhatsappAuthEnabled() {
  return process.env.AUTH_MODE === "api" && Boolean(process.env.AUTH_API_URL?.trim());
}

export async function callWhatsappAuthApi(path: "/auth/send-code" | "/auth/verify-code", body: WhatsappAuthPayload) {
  const response = await fetch(buildAuthApiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.AUTH_API_SECRET ? { Authorization: `Bearer ${process.env.AUTH_API_SECRET}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : "whatsapp-auth-api-failed";
    throw new Error(message);
  }

  return data;
}

