import { NextRequest, NextResponse } from 'next/server';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { enviarPushParaCliente, type PushPayload } from '@/lib/webpush';

export type TipoNotificacao = 'entregador_saiu' | 'entregador_chegando';

export async function POST(req: NextRequest) {
  try {
    const { clientId, tipo, etaMinutos, slug } = await req.json() as {
      clientId: string;
      tipo: TipoNotificacao;
      etaMinutos?: number;
      slug?: string;
    };

    if (!clientId || !tipo) {
      return NextResponse.json({ error: 'clientId e tipo são obrigatórios.' }, { status: 400 });
    }

    // Busca a subscription do cliente no Firestore
    const subDoc = await getDoc(doc(db, 'Users', clientId, 'pushSubscription', 'default'));
    if (!subDoc.exists()) {
      return NextResponse.json({ error: 'Cliente sem subscription de notificação.' }, { status: 404 });
    }

    const subscription = subDoc.data() as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    const url = slug ? `/${slug}` : '/';

    let payload: PushPayload;

    if (tipo === 'entregador_saiu') {
      const eta = etaMinutos ?? 30;
      payload = {
        title: 'Pedido a caminho! 🛵',
        body: `Seu entregador saiu. Previsão de chegada: ${eta} min.`,
        url,
        tag: 'entrega-saiu',
      };
    } else {
      payload = {
        title: 'Entregador chegando! 📦',
        body: 'Seu entregador está chegando. Prepare-se para receber!',
        url,
        tag: 'entrega-chegando',
      };
    }

    await enviarPushParaCliente(subscription, payload);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao enviar notificação.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
