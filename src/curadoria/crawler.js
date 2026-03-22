const Parser = require('rss-parser');
const { FEEDS } = require('./feeds');

const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'TNeris-Curadoria/1.0' },
  customFields: { item: ['media:thumbnail', 'enclosure'] },
});

let cache = {};
let lastUpdate = null;

function stripHtml(str = '') {
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function fetchCategory(key) {
  const category = FEEDS[key];
  const articles = [];

  await Promise.allSettled(
    category.sources.map(async (source) => {
      try {
        const feed = await parser.parseURL(source.url);
        const items = (feed.items || []).slice(0, 6).map((item) => ({
          title:   (item.title || '').trim(),
          link:    item.link || item.guid || '',
          summary: stripHtml(item.contentSnippet || item.content || item.summary || ''),
          date:    item.pubDate || item.isoDate || '',
          source:  source.name,
        }));
        articles.push(...items);
      } catch (err) {
        console.warn(`⚠️  Feed falhou [${source.name}]: ${err.message}`);
      }
    })
  );

  return articles
    .filter((a) => a.title && a.link)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 25);
}

async function refreshAll() {
  console.log('📰 Atualizando curadoria...');
  const newCache = {};
  for (const key of Object.keys(FEEDS)) {
    newCache[key] = await fetchCategory(key);
  }
  cache = newCache;
  lastUpdate = new Date();
  console.log(`✅ Curadoria OK — ${lastUpdate.toLocaleString('pt-BR')}`);
}

function getCache() {
  return {
    data:         cache,
    lastUpdate:   lastUpdate ? lastUpdate.toLocaleString('pt-BR') : null,
    categories:   Object.entries(FEEDS).map(([key, cat]) => ({
      key,
      label: cat.label,
      icon:  cat.icon,
      color: cat.color,
    })),
  };
}

function isCacheStale() {
  if (!lastUpdate) return true;
  const hours = (Date.now() - lastUpdate.getTime()) / 36e5;
  return hours >= 6;
}

module.exports = { refreshAll, getCache, isCacheStale };
