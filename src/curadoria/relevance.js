'use strict';

const { cleanText } = require('./text');

const THEMES = [
  /\bneg[oó]cios?\b/i,
  /\bempresas?\b/i,
  /\bempreend\w*/i,
  /\b(mei|pme)\b/i,
  /\bpequen[oa]s?\b/i,
  /\bmicroempreendedor\w*/i,
  /\bfaturamento\b/i,
  /\bprecif\w*/i,
  /\bvendas?\b/i,
  /\bvender\b/i,
  /\bmarketing\b/i,
  /\bmarcas?\b/i,
  /\bposicionamento\b/i,
  /comunica/i,
  /conte[uú]do/i,
  /\binstagram\b/i,
  /\bcreators?\b/i,
  /\bcriador(?:es|a|as)?\b/i,
  /influenc/i,
  /\balgoritmo\b/i,
  /intelig[eê]ncia artificial/i,
  /\bchatgpt\b/i,
  /\bopenai\b/i,
  /\b(ai|ia)\b/i,
  /automa[cçt]/i,
  /redes sociais/i,
  /\ban[uú]ncios?\b/i,
  /\bpublicidade\b/i,
  /\bcampanhas?\b/i,
  /brand/i,
  /\bclientes?\b/i,
  /\bconsumidor(?:es|a|as)?\b/i,
  /\bconsumo\b/i,
  /\bm[ií]dia\b/i,
  /\bcomportamento\b/i,
  /tend[eê]ncia/i,
  /e-?commerce/i,
  /\bwhatsapp\b/i,
  /monetiz/i,
  /\bassinatura\b/i,
  /recorr[eê]n/i,
  /produtiv/i,
  /gest[aã]o/i,
  /lideran[cç]a/i,
  /\bmentoria\b/i,
  /lan[cç]amento/i,
  /tr[aá]fego/i,
  /convers[aã]o/i,
  /\bfunil\b/i,
  /\bleads?\b/i,
  /\bcrm\b/i,
  /\bseo\b/i,
  /\b(ad|ads)\b/i,
  /\btiktok\b/i,
  /\breels\b/i,
  /\bcrescimento\b/i,
  /\bmargem\b/i,
  /\bvarejo\b/i,
  /\bblack friday\b/i,
  /afiliad/i,
  /\byoutube\b/i,
  /\bparceria\b/i,
  /\bstartup\b/i,
  /\bsmall business\b/i,
  /\bentrepreneur/i,
  /\bsocial media\b/i,
  /\badvertising\b/i,
  /\bconsumer\b/i,
  /\bpricing\b/i,
  /\bcopywriting\b/i,
];

const CATEGORY_THEMES = {
  moda_cultura: [
    /\bmoda\b/i,
    /\bspfw\b/i,
    /\bfashion\b/i,
    /\bcole[cç][aã]o\b/i,
    /\bdesfile\b/i,
    /\bluxo\b/i,
    /\bbeleza\b/i,
  ],
};

const HARD_BLOCK = [
  /\bmega[-\s]?sena\b/i,
  /\blotof[aá]cil\b/i,
  /\blotomania\b/i,
  /\btimemania\b/i,
  /\bdupla sena\b/i,
  /\bdia de sorte\b/i,
  /\bquina\b/i,
  /\b(flamengo|corinthians|palmeiras|vasco|botafogo|gr[eê]mio|s[aã]o paulo fc|atl[eé]tico-mg|atl[eé]tico mineiro)\b/i,
  /\bbrasileir[aã]o\b/i,
  /\blibertadores\b/i,
  /\bp[eê]naltis\b/i,
  /\bchampions league\b/i,
  /\bpremier league\b/i,
  /elei[cç][aã]o|elei[cç][oõ]es|eleicoes|eleitoral|eleitor(?:es)?/i,
  /\bsegundo turno\b/i,
  /\bbolsonaro\b/i,
  /\blula\b/i,
  /\b(impeachment|urna eletr[oô]nica)\b/i,
  /\b(trump|biden|midterms?|white house|democrats?|republicans?|politics|voters?|election)\b/i,
  /\bredesigna[cç][aã]o sexual\b/i,
  /\bcausa da morte\b/i,
  /\bbig brother\b/i,
  /\bbbb\b/i,
];

const SOFT_BLOCK = [
  /\bfutebol\b/i,
  /\bcandidat[oa]\b/i,
  /\b(d[oó]lar|ibovespa|selic|bitcoin|criptomoedas?|petr[oó]leo)\b/i,
  /\bvac[aâ]ncia\b/i,
  /\bcondom[ií]nios? log[ií]stic/i,
  /\b(importa[cç][oõ]es|importa[cç][aã]o|exporta[cç][oõ]es|exporta[cç][aã]o)\b/i,
  /\b(bets|apostas|cassino)\b/i,
  /\b(homic[ií]dio|assassinato|latroc[ií]nio)\b/i,
  /\b(gta|playstation|nintendo|videogame)\b/i,
  /\bmeteoros?\b/i,
  /\bprevis[aã]o do tempo\b/i,
  /\b(stf|tse)\b/i,
];

const STOPWORDS = new Set([
  'para', 'como', 'com', 'uma', 'uns', 'umas', 'sobre', 'mais', 'depois', 'entre',
  'pelo', 'pela', 'pelos', 'pelas', 'seus', 'suas', 'seu', 'sua', 'essa', 'esse',
  'este', 'esta', 'isto', 'quando', 'onde', 'quem', 'nas', 'nos', 'das', 'dos',
  'que', 'nao', 'não', 'anos', 'ano', 'novo', 'nova', 'novos', 'novas', 'brasil',
  'brasileiro', 'brasileira', 'anuncia', 'anunciam', 'lanca', 'lança', 'mostra',
  'afirma', 'afirmam', 'pode', 'podem', 'mercado', 'empresa', 'empresas', 'hoje',
  'ainda', 'muito', 'muita', 'the', 'and', 'with', 'from', 'that', 'this', 'your',
  'how', 'why', 'new', 'for', 'after', 'into', 'over', 'says', 'what', 'when',
]);

const CATEGORY_LIMIT = 12;
const PER_SOURCE = 4;
const FRESH_MS = 120 * 24 * 60 * 60 * 1000;
const STALE_MS = 400 * 24 * 60 * 60 * 1000;

function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function themeScore(text, categoryKey) {
  const patterns = THEMES.concat(CATEGORY_THEMES[categoryKey] || []);
  let score = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) score += 1;
  }
  return score;
}

function isHardBlocked(text) {
  if (matchesAny(HARD_BLOCK, text)) return true;
  if (/\bfl[aá]vio\b/i.test(text) && /\b(bolsonaro|lula|turno|tse|elei)/i.test(text)) return true;
  return false;
}

function assess(title, categoryKey, summary = '') {
  const titleText = cleanText(title);
  const summaryText = cleanText(summary);
  const blob = `${titleText} ${summaryText}`;
  if (isHardBlocked(blob)) return { drop: true, score: 0, lang: detectLang(titleText, 'pt') };
  const score = themeScore(titleText, categoryKey);
  const soft = matchesAny(SOFT_BLOCK, blob);
  const drop = score < 1 || (soft && score < 2);
  return { drop, score, lang: detectLang(titleText, 'pt') };
}

function detectLang(title, fallback) {
  if (/[áàâãéêíóôõúç]/i.test(title)) return 'pt';
  const portuguese = (title.match(/\b(não|para|com|uma|como|mais|você|sobre|após|entre|pelo|pela|dos|das)\b/gi) || []).length;
  const english = (title.match(/\b(the|and|with|for|from|that|this|how|why|your|new)\b/gi) || []).length;
  if (portuguese > english) return 'pt';
  if (english > portuguese) return 'en';
  return fallback === 'pt' ? 'pt' : 'en';
}

function signature(title) {
  const normalized = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized.split(' ').filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

function similar(left, right) {
  if (!left.length || !right.length) return false;
  const other = new Set(right);
  let shared = 0;
  for (const token of left) {
    if (other.has(token)) shared += 1;
  }
  if (shared < 2) return false;
  return shared / Math.min(left.length, right.length) >= 0.5;
}

function conflicts(sig, sigs) {
  return sigs.some((other) => similar(sig, other));
}

function canonicalLink(link) {
  try {
    const url = new URL(link);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || key === 'fbclid' || key === 'mc_cid' || key === 'mc_eid') {
        url.searchParams.delete(key);
      }
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.origin}${path}${url.search}`;
  } catch {
    return cleanText(link);
  }
}

function timestamp(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function isRecent(date, windowMs) {
  const time = timestamp(date);
  if (!time) return true;
  const age = Date.now() - time;
  return age <= windowMs;
}

function roundRobin(items, maxTake) {
  const queues = [];
  const bySource = new Map();
  const sorted = items.slice().sort((a, b) => timestamp(b.date) - timestamp(a.date));
  for (const item of sorted) {
    if (!bySource.has(item.source)) {
      const queue = [];
      bySource.set(item.source, queue);
      queues.push(queue);
    }
    bySource.get(item.source).push(item);
  }

  const picked = [];
  let progressed = true;
  while (picked.length < maxTake && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (!queue.length || picked.length >= maxTake) continue;
      picked.push(queue.shift());
      progressed = true;
    }
  }
  return picked;
}

function mixLanguages(items) {
  const portuguese = items.filter((item) => item._lang === 'pt');
  const english = items.filter((item) => item._lang !== 'pt');
  const picked = [];
  const seen = new Set();

  function add(list, maxTake) {
    for (const item of roundRobin(list, maxTake)) {
      if (picked.length >= CATEGORY_LIMIT || seen.has(item)) continue;
      seen.add(item);
      picked.push(item);
    }
  }

  add(portuguese, 8);
  add(english, portuguese.length >= 4 ? 4 : CATEGORY_LIMIT);
  if (picked.length < 6) {
    add(portuguese, CATEGORY_LIMIT);
    add(english, CATEGORY_LIMIT);
  }
  return picked;
}

function curateCategory(articles, categoryKey, state) {
  const fresh = [];
  const stale = [];
  for (const article of articles) {
    const title = cleanText(article.title);
    const summary = cleanText(article.summary, 220);
    if (!title || title.length < 12) continue;
    if (/^(aviso|rss|feed|home)$/i.test(title)) continue;
    const verdict = assess(title, categoryKey, summary);
    if (verdict.drop) continue;
    const link = canonicalLink(article.link);
    if (!link) continue;
    const entry = {
      title,
      link,
      summary,
      date: article.date || '',
      source: article.source,
      _lang: detectLang(title, article.lang),
      _sig: signature(title),
    };
    if (isRecent(article.date, FRESH_MS) || !timestamp(article.date)) fresh.push(entry);
    else if (isRecent(article.date, STALE_MS)) stale.push(entry);
  }

  const freshSources = new Set(fresh.map((article) => article.source));
  const newestStale = new Map();
  for (const article of stale) {
    if (freshSources.has(article.source)) continue;
    const current = newestStale.get(article.source);
    if (!current || timestamp(article.date) > timestamp(current.date)) newestStale.set(article.source, article);
  }

  const ranked = fresh.concat([...newestStale.values()]);
  ranked.sort((a, b) => timestamp(b.date) - timestamp(a.date));

  const accepted = [];
  const localLinks = new Set();
  const localSigs = [];
  const perSource = {};
  for (const article of ranked) {
    if (state.links.has(article.link) || localLinks.has(article.link)) continue;
    if (conflicts(article._sig, state.sigs) || conflicts(article._sig, localSigs)) continue;
    perSource[article.source] = perSource[article.source] || 0;
    if (perSource[article.source] >= PER_SOURCE) continue;
    perSource[article.source] += 1;
    accepted.push(article);
    localLinks.add(article.link);
    localSigs.push(article._sig);
  }

  const picked = mixLanguages(accepted);
  for (const article of picked) {
    state.links.add(article.link);
    state.sigs.push(article._sig);
  }

  return picked
    .sort((a, b) => timestamp(b.date) - timestamp(a.date))
    .map((article) => ({
      title: article.title,
      link: article.link,
      summary: article.summary,
      date: article.date,
      source: article.source,
    }));
}

module.exports = {
  assess,
  curateCategory,
  canonicalLink,
  signature,
  similar,
  detectLang,
};
