// Gera as chaves VAPID necessárias para Web Push
// Execute: node scripts/generate-vapid.js
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\n=== VAPID Keys geradas ===\n');
console.log('Copie para o .env.local e nas variáveis de ambiente do Render:\n');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('\nNota: NEXT_PUBLIC_VAPID_PUBLIC_KEY (cliente) e VAPID_PUBLIC_KEY (servidor) devem ter o mesmo valor.\n');
