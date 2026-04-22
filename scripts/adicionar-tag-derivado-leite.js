/**
 * Adiciona a tag "#derivado do leite" em produtos cujo nome contém "leite".
 * Escopo fixo: estabelecimento jQQjHTCc2zW1tuZMQzGF
 *
 * Uso:
 *   node scripts/adicionar-tag-derivado-leite.js         -> dry-run (não altera)
 *   node scripts/adicionar-tag-derivado-leite.js --run   -> aplica alterações
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, writeBatch } = require('firebase/firestore');

const COMPANY_ID = 'jQQjHTCc2zW1tuZMQzGF';
const TAG_ALVO = '#derivado do leite';

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
const db = getFirestore(app);

function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function toTagArray(raw) {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,\n;|]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function temTag(tags, tagAlvo) {
  const alvo = normalizar(tagAlvo).replace(/^#/, '').trim();
  return tags.some((t) => normalizar(t).replace(/^#/, '').trim() === alvo);
}

async function buscarProdutos() {
  const col = collection(db, 'estabelecimentos', COMPANY_ID, 'Products');
  const snap = await getDocs(col);
  return snap.docs;
}

async function dryRun() {
  const docs = await buscarProdutos();
  const candidatos = [];
  let jaTinham = 0;

  for (const d of docs) {
    const data = d.data();
    const nome = String(data.name ?? '');
    if (!normalizar(nome).includes('leite')) continue;

    const tags = toTagArray(data.tags);
    if (temTag(tags, TAG_ALVO)) {
      jaTinham++;
      continue;
    }

    candidatos.push({ id: d.id, nome, tagsAtuais: tags });
  }

  console.log('\n=== DRY-RUN — nenhuma alteração feita ===\n');
  console.log(`Estabelecimento                 : ${COMPANY_ID}`);
  console.log(`Total de produtos               : ${docs.length}`);
  console.log(`Produtos com "leite" no nome    : ${candidatos.length + jaTinham}`);
  console.log(`Já com a tag alvo               : ${jaTinham}`);
  console.log(`Receberão a tag                 : ${candidatos.length}`);

  if (candidatos.length > 0) {
    console.log('\nAmostra (até 20):');
    candidatos.slice(0, 20).forEach((p, i) => {
      console.log(`${i + 1}. [${p.id}] ${p.nome}`);
    });
  }

  console.log('\nPara executar: node scripts/adicionar-tag-derivado-leite.js --run');
}

async function run() {
  const docs = await buscarProdutos();
  const alvo = [];

  for (const d of docs) {
    const data = d.data();
    const nome = String(data.name ?? '');
    if (!normalizar(nome).includes('leite')) continue;

    const tags = toTagArray(data.tags);
    if (temTag(tags, TAG_ALVO)) continue;

    alvo.push({ ref: d.ref, tagsNovas: [...tags, TAG_ALVO] });
  }

  if (alvo.length === 0) {
    console.log('\nNenhum produto elegível encontrado. Nada a fazer.');
    return;
  }

  const BATCH_SIZE = 450;
  for (let i = 0; i < alvo.length; i += BATCH_SIZE) {
    const lote = writeBatch(db);
    alvo.slice(i, i + BATCH_SIZE).forEach((p) => {
      lote.update(p.ref, { tags: p.tagsNovas });
    });
    await lote.commit();
    console.log(`Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${Math.min(i + BATCH_SIZE, alvo.length)} / ${alvo.length}`);
  }

  console.log(`\n✓ Tag "${TAG_ALVO}" adicionada em ${alvo.length} produto(s).`);
}

const arg = process.argv[2];

(async () => {
  try {
    if (arg === '--run') await run();
    else await dryRun();
  } catch (err) {
    console.error('\nErro:', err?.message || err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();

