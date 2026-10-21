const Parser = require('rss-parser');
const { FEEDS, DEDUPE_PRIORITY } = require('./feeds');
const { gerarPautas } = require('./analisar');
const { decodeFeed, cleanText } = require('./text');
const { curateCategory } = require('./relevance');

const parser = new Parser({
  customFields: { item: ['content:encoded'] },
});

const USER_AGENT = 'Mozilla/5.0 (compatible; TNeris-Curadoria/1.0; +https://www.talitaneris.com.br/curadoria)';
const FETCH_TIMEOUT_MS = 8000;

let cache = {};
let pautasCache = [];
let lastUpdate = null;
let refreshPromise = null;

function orderedKeys() {
  const keys = Object.keys(FEEDS);
  return DEDUPE_PRIORITY.filter((key) => keys.includes(key))
    .concat(keys.filter((key) => !DEDUPE_PRIORITY.includes(key)));
}

async function fetchFeed(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(source.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    let xml = decodeFeed(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type') || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    const start = xml.search(/<(?:rss|feed|rdf:RDF)\b/i);
    if (start > 0) xml = xml.slice(start);
    if (start < 0) throw new Error('resposta não é RSS/Atom');

    const feed = await parser.parseString(xml);
    return (feed.items || []).slice(0, 8).map((item) => ({
      title: cleanText(item.title),
      link: item.link || (typeof item.guid === 'string' ? item.guid : ''),
      summary: cleanText(item.contentSnippet || item.summary || item.content || '', 220),
      date: item.isoDate || item.pubDate || '',
      source: source.name,
      lang: source.lang,
    })).filter((article) => article.title && article.link);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCategory(key) {
  const results = await Promise.all(FEEDS[key].sources.map(async (source) => {
    try {
      return await fetchFeed(source);
    } catch (err) {
      const message = err.name === 'AbortError' ? 'timeout' : err.message;
      console.warn(`⚠️  Feed falhou [${source.name}]: ${message}`);
      return [];
    }
  }));
  return results.flat();
}

async function runRefresh() {
  console.log('📰 Atualizando curadoria...');
  const fetched = {};
  await Promise.all(Object.keys(FEEDS).map(async (key) => {
    fetched[key] = await fetchCategory(key);
  }));

  const state = { links: new Set(), sigs: [] };
  const curated = {};
  for (const key of orderedKeys()) {
    curated[key] = curateCategory(fetched[key] || [], key, state);
    console.log(`  ${key}: ${(fetched[key] || []).length} lidos → ${curated[key].length} publicados`);
  }

  const newCache = {};
  for (const key of Object.keys(FEEDS)) newCache[key] = curated[key] || [];
  cache = newCache;
  lastUpdate = new Date();
  console.log(`✅ Curadoria OK — ${lastUpdate.toLocaleString('pt-BR')}`);

  const todosArtigos = Object.values(newCache).flat();
  pautasCache = await gerarPautas(todosArtigos);
  const origem = !pautasCache.length
    ? 'vazio'
    : (pautasCache.every((pauta) => pauta.fallback) ? 'fallback' : (pautasCache.some((pauta) => pauta.fallback) ? 'misto' : 'ia'));
  console.log(`🧠 Pautas: ${pautasCache.length} (${origem})`);
}

async function refreshAll() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = runRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function sourceCount() {
  return Object.values(FEEDS).reduce((total, category) => total + category.sources.length, 0);
}

function getCache() {
  return {
    data: cache,
    pautas: pautasCache,
    lastUpdate: lastUpdate ? lastUpdate.toLocaleString('pt-BR') : null,
    sourceCount: sourceCount(),
    categories: Object.entries(FEEDS).map(([key, category]) => ({
      key,
      label: category.label,
      icon: category.icon,
      color: category.color,
    })),
  };
}

function getPautas() {
  return pautasCache;
}

function isCacheStale() {
  if (!lastUpdate) return true;
  const hours = (Date.now() - lastUpdate.getTime()) / 36e5;
  return hours >= 6;
}

module.exports = { refreshAll, getCache, getPautas, isCacheStale };
