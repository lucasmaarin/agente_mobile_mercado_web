import webpush from 'web-push';

let configured = false;

function configurar() {
  if (configured) return;
  const publicKey  = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject    = process.env.VAPID_SUBJECT || 'mailto:admin@agente-mobile.com';

  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY são obrigatórios. Gere com: node scripts/generate-vapid.js');
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
};

export type PushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function enviarPushParaCliente(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<void> {
  configurar();
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}
