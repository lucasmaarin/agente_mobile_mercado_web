/**
 * Remove o campo `tags` de todos os produtos de um estabelecimento.
 * Usa o SDK cliente do Firebase — mesmas credenciais do .env.local.
 *
 * Uso:
 *   node scripts/limpar-tags-produtos.js          — lista quantos produtos seriam afetados (dry-run)
 *   node scripts/limpar-tags-produtos.js --run     — remove as tags (salva backup antes)
 *   node scripts/limpar-tags-produtos.js --undo    — restaura as tags do último backup
 */

// Carrega .env.local antes de tudo
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const { initializeApp }                              = require('firebase/app');
const { getFirestore, collection, doc, getDocs,
        writeBatch, deleteField, updateDoc }         = require('firebase/firestore');
const fs   = require('fs');
const path = require('path');

// ── Configuração ──────────────────────────────────────────────────────────────

const COMPANY_ID  = 'jQQjHTCc2zW1tuZMQzGF';
const BACKUP_FILE = path.join(__dirname, `backup-tags-${COMPANY_ID}.json`);

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL:       process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buscarProdutos() {
  const col  = collection(db, 'estabelecimentos', COMPANY_ID, 'Products');
  const snap = await getDocs(col);
  return snap.docs;
}

function salvarBackup(docs) {
  const data = docs.map(d => ({ id: d.id, tags: d.data().tags ?? null }));
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\nBackup salvo em: ${BACKUP_FILE} (${data.length} produtos)`);
}

// ── Comandos ──────────────────────────────────────────────────────────────────

async function dryRun() {
  const docs    = await buscarProdutos();
  const comTags = docs.filter(d => d.data().tags != null);
  const semTags = docs.filter(d => d.data().tags == null);

  console.log('\n=== DRY-RUN — nenhuma alteração feita ===\n');
  console.log(`Total de produtos         : ${docs.length}`);
  console.log(`Com tags (seriam limpos)  : ${comTags.length}`);
  console.log(`Sem tags (sem alteração)  : ${semTags.length}`);
  console.log('\nPara executar: node scripts/limpar-tags-produtos.js --run');
}

async function run() {
  const docs    = await buscarProdutos();
  const comTags = docs.filter(d => d.data().tags != null);

  if (comTags.length === 0) {
    console.log('\nNenhum produto com tags encontrado — nada a fazer.');
    return;
  }

  salvarBackup(comTags);

  // writeBatch suporta até 500 operações por lote
  const BATCH_SIZE = 500;
  for (let i = 0; i < comTags.length; i += BATCH_SIZE) {
    const lote = writeBatch(db);
    comTags.slice(i, i + BATCH_SIZE).forEach(d => {
      lote.update(d.ref, { tags: deleteField() });
    });
    await lote.commit();
    console.log(`  Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${Math.min(i + BATCH_SIZE, comTags.length)} / ${comTags.length} produtos processados`);
  }

  console.log(`\n✓ Tags removidas de ${comTags.length} produto(s).`);
  console.log('Para desfazer: node scripts/limpar-tags-produtos.js --undo');
}

async function undo() {
  if (!fs.existsSync(BACKUP_FILE)) {
    console.error('\nNenhum backup encontrado. Execute --run antes de --undo.');
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));

  if (backup.length === 0) {
    console.log('\nBackup vazio — nada a restaurar.');
    return;
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < backup.length; i += BATCH_SIZE) {
    const lote = writeBatch(db);
    backup.slice(i, i + BATCH_SIZE).forEach(({ id, tags }) => {
      if (tags != null) {
        const ref = doc(db, 'estabelecimentos', COMPANY_ID, 'Products', id);
        lote.update(ref, { tags });
      }
    });
    await lote.commit();
  }

  console.log(`\n✓ Tags restauradas em ${backup.length} produto(s).`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const arg = process.argv[2];

(async () => {
  try {
    if      (arg === '--run')  await run();
    else if (arg === '--undo') await undo();
    else                       await dryRun();
  } catch (err) {
    console.error('\nErro:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
