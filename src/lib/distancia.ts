/**
 * Geocodificação e cálculo de distância para entregas.
 *
 * Controle via env:
 *   NEXT_PUBLIC_DELIVERY_LIMIT_ENABLED=false  → valida endereço mas não bloqueia pedidos
 *   NEXT_PUBLIC_DELIVERY_LIMIT_KM=10          → limite em km (padrão: 10)
 */

export type Coordenadas = { lat: number; lng: number };

export type ResultadoDistancia = {
  distanciaKm: number;
  dentroDoRaio: boolean;
  limiteBloqueante: boolean; // true somente se DELIVERY_LIMIT_ENABLED=true E fora do raio
  etaMinutos: number;        // estimativa de tempo de entrega baseada na distância
};

// Fórmula de Haversine
function haversine(a: Coordenadas, b: Coordenadas): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

// ETA estimado: base de 10min + 3min por km
function calcularEta(distanciaKm: number): number {
  return Math.round(10 + distanciaKm * 3);
}

export async function geocodificarEndereco(
  endereco: string
): Promise<Coordenadas | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(endereco + ', Brasil')}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AgenteMovile/1.0' },
    });
    const data = await res.json();
    if (!data?.[0]) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

export async function verificarDistanciaEntrega(
  enderecoCliente: string,
  coordsEstabelecimento: Coordenadas
): Promise<ResultadoDistancia | null> {
  const coordsCliente = await geocodificarEndereco(enderecoCliente);
  if (!coordsCliente) return null;

  const limiteBloqueadoEnv = process.env.NEXT_PUBLIC_DELIVERY_LIMIT_ENABLED === 'true';
  const limiteKm = parseFloat(process.env.NEXT_PUBLIC_DELIVERY_LIMIT_KM ?? '10');

  const distanciaKm = haversine(coordsEstabelecimento, coordsCliente);
  const dentroDoRaio = distanciaKm <= limiteKm;

  return {
    distanciaKm: Math.round(distanciaKm * 10) / 10,
    dentroDoRaio,
    limiteBloqueante: limiteBloqueadoEnv && !dentroDoRaio,
    etaMinutos: calcularEta(distanciaKm),
  };
}
