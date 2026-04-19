/**
 * Limpa documentos em estabelecimentos/{id} do Firestore,
 * mantendo apenas os IDs listados em MANTER.
 *
 * Uso:
 *   node scripts/limpar-estabelecimentos.js          — lista o que seria removido (dry-run)
 *   node scripts/limpar-estabelecimentos.js --run     — executa a limpeza (salva backup)
 *   node scripts/limpar-estabelecimentos.js --undo    — restaura o último backup
 *
 * Requisitos:
 *   npm install firebase-admin
 *   Variável de ambiente GOOGLE_APPLICATION_CREDENTIALS apontando para o service account JSON
 *   OU coloque o caminho do JSON em SERVICE_ACCOUNT_PATH abaixo.
 */

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

// ── Configuração ──────────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ?? path.join(__dirname, 'serviceAccountKey.json');

const MANTER = new Set([
  'estabelecimento-teste',
  'jQQjHTCc2zW1tuZMQzGF',
  'GkFYWdOBKD1vbzYoem9K',
  'q0IPIusmpEq3pHbMyfWY',
  'XAXMOP6aweRbBAb0gUvU',
  'b3XQWKJ8p0clDrRRXoURvD1DVM43',
]);

const BACKUP_FILE = path.join(__dirname, 'backup-estabelecimentos.json');
const COLECAO     = 'estabelecimentos';

// ── Init ──────────────────────────────────────────────────────────────────────

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function listarTodos() {
  const snap = await db.collection(COLECAO).get();
  return snap.docs;
}

function salvarBackup(docs) {
  const data = docs.map(d => ({ id: d.id, data: d.data() }));
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\nBackup salvo em: ${BACKUP_FILE} (${data.length} documentos)`);
}

// ── Comandos ──────────────────────────────────────────────────────────────────

async function dryRun() {
  const docs   = await listarTodos();
  const remover = docs.filter(d => !MANTER.has(d.id));
  const manter  = docs.filter(d =>  MANTER.has(d.id));

  console.log('\n=== DRY-RUN — nenhuma alteração feita ===\n');
  console.log(`Manter  (${manter.length}): ${manter.map(d => d.id).join(', ')}`);
  console.log(`Remover (${remover.length}): ${remover.map(d => d.id).join(', ') || '(nenhum)'}`);
  console.log('\nPara executar: node scripts/limpar-estabelecimentos.js --run');
}

async function run() {
  const docs    = await listarTodos();
  const remover = docs.filter(d => !MANTER.has(d.id));

  if (remover.length === 0) {
    console.log('\nNada a remover — todos os documentos já estão na lista MANTER.');
    return;
  }

  // Salva backup antes de deletar
  salvarBackup(remover);

  // Deleta em lotes de 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < remover.length; i += BATCH_SIZE) {
    const lote = db.batch();
    remover.slice(i, i + BATCH_SIZE).forEach(d => lote.delete(d.ref));
    await lote.commit();
  }

  console.log(`\n✓ ${remover.length} documento(s) removido(s):`);
  remover.forEach(d => console.log(`  - ${d.id}`));
  console.log('\nPara desfazer: node scripts/limpar-estabelecimentos.js --undo');
}

async function undo() {
  if (!fs.existsSync(BACKUP_FILE)) {
    console.error('\nNenhum backup encontrado. Execute --run antes de --undo.');
    process.exit(1);
  }

  const docs = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));

  if (docs.length === 0) {
    console.log('\nBackup vazio — nada a restaurar.');
    return;
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const lote = db.batch();
    docs.slice(i, i + BATCH_SIZE).forEach(({ id, data }) => {
      lote.set(db.collection(COLECAO).doc(id), data);
    });
    await lote.commit();
  }

  console.log(`\n✓ ${docs.length} documento(s) restaurado(s):`);
  docs.forEach(d => console.log(`  + ${d.id}`));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const arg = process.argv[2];

(async () => {
  try {
    if (arg === '--run')  await run();
    else if (arg === '--undo') await undo();
    else await dryRun();
  } catch (err) {
    console.error('\nErro:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
