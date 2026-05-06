'use strict';

const DEFAULT_BRANCH = 'main';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CONTEXT_CHARS = 14000;

const BASE_DOCS = [
  'README.md',
  '00-identidade/talita-quem-e.md',
  '00-identidade/talita-gaps-habilidades.md',
  '02-empresa/tneris-identidade.md',
  '05-squad/arquitetura-agentes.md',
  '05-squad/cultura-agentes.md',
  '05-squad/memoria-operacional-agentes.md',
  '05-squad/acessos-e-dados-agentes.md',
];

const AGENT_DOCS = {
  nara: [
    '05-squad/nara-integracao-dados.md',
    '05-squad/canais-agentes.md',
    '06-financeiro/diagnostico-financeiro.md',
    '06-financeiro/contratos-ativos.md',
    '01-editorial/linha-editorial.md',
  ],
  lua: [
    '05-squad/canais-agentes.md',
    '06-financeiro/diagnostico-financeiro.md',
  ],
  jay: [
    '06-financeiro/diagnostico-financeiro.md',
    '07-produto/atribus-oferta.md',
    '07-produto/atribus-icp.md',
  ],
  sofia: [
    '06-financeiro/diagnostico-financeiro.md',
    '06-financeiro/contratos-ativos.md',
  ],
  mari: [
    '04-mentoria/jornada-d0-d180.md',
    '04-mentoria/mentoradas/brenda.md',
    '04-mentoria/mentoradas/carol-prestes.md',
    '04-mentoria/mentoradas/damaris.md',
    '04-mentoria/mentoradas/deborah.md',
    '04-mentoria/mentoradas/eli-aparicio.md',
    '04-mentoria/mentoradas/katy.md',
    '04-mentoria/mentoradas/matheus-renato-wesley.md',
    '04-mentoria/mentoradas/renata.md',
    '04-mentoria/mentoradas/thaissa.md',
    '04-mentoria/mentoradas/viviane.md',
  ],
  lia: [
    '07-produto/atribus-oferta.md',
    '07-produto/atribus-icp.md',
  ],
  marta: [
    '07-produto/atribus-oferta.md',
    '07-produto/atribus-icp.md',
    '06-financeiro/diagnostico-financeiro.md',
  ],
  vega: [
    '00-identidade/talita-identidade.md',
    '00-identidade/talita-historias.md',
    '01-editorial/linha-editorial.md',
    '03-voz/palavras-proibidas.md',
    '03-voz/talita-voz.md',
    '05-squad/people-vega.md',
  ],
  people: [
    '00-identidade/talita-historias.md',
    '01-editorial/linha-editorial.md',
    '03-voz/palavras-proibidas.md',
    '03-voz/talita-voz.md',
    '03-voz/stories-copy.md',
    '03-voz/cronograma-stories.md',
  ],
  alex: [
    '03-voz/palavras-proibidas.md',
    '05-squad/alex-design.md',
    '05-squad/people-vega.md',
  ],
  paulo: [
    '02-empresa/atribus-metodo.md',
    '07-produto/atribus-oferta.md',
  ],
  lens: [
    '06-financeiro/diagnostico-financeiro.md',
    '05-squad/canais-agentes.md',
  ],
  assistente: [
    '00-identidade/talita-saude-rotina.md',
    '00-identidade/talita-reset-pessoal.md',
    '05-squad/canais-agentes.md',
  ],
};

const cache = new Map();

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function decodeBase64(value) {
  return Buffer.from(value || '', 'base64').toString('utf8');
}

function truncateMiddle(text, maxChars) {
  if (!text || text.length <= maxChars) return text || '';

  const head = Math.floor(maxChars * 0.65);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n\n[...contexto privado truncado para caber no prompt...]\n\n${text.slice(-tail)}`;
}

async function fetchPrivateFile(path) {
  const token = process.env.PRIVATE_CONTEXT_GITHUB_TOKEN;
  const repo = process.env.PRIVATE_CONTEXT_REPO;
  const branch = process.env.PRIVATE_CONTEXT_BRANCH || DEFAULT_BRANCH;

  if (!token || !repo) return '';

  const cacheKey = `${repo}:${branch}:${path}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.content;
  }

  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const url = `https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tneris-slack-bot',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn(`⚠️ Contexto privado indisponível: ${path} (${response.status}) ${body.slice(0, 160)}`);
    return '';
  }

  const data = await response.json();
  const content = decodeBase64(data.content);
  cache.set(cacheKey, { ts: Date.now(), content });
  return content;
}

async function getPrivateContextForAgent(agentKey) {
  const token = process.env.PRIVATE_CONTEXT_GITHUB_TOKEN;
  const repo = process.env.PRIVATE_CONTEXT_REPO;
  if (!token || !repo) return '';

  const docs = unique([...BASE_DOCS, ...(AGENT_DOCS[agentKey] || [])]);
  const parts = [];

  for (const path of docs) {
    try {
      const content = await fetchPrivateFile(path);
      if (content && content.trim()) {
        parts.push(`### ${path}\n${content.trim()}`);
      }
    } catch (err) {
      console.warn(`⚠️ Falha ao carregar contexto privado ${path}: ${err.message}`);
    }
  }

  if (parts.length === 0) {
    console.warn(`⚠️ Contexto privado não carregou para ${agentKey}: nenhum documento retornou conteúdo.`);
    return '';
  }

  const context = truncateMiddle(
    [
      'CONTEXTO PRIVADO TNeris:',
      'Use como fonte de verdade. Não exponha dados sensíveis sem necessidade. Se houver conflito, este contexto vence o prompt antigo.',
      '',
      parts.join('\n\n---\n\n'),
    ].join('\n'),
    MAX_CONTEXT_CHARS
  );

  console.log(`📚 Contexto privado carregado para ${agentKey}: ${parts.length} documentos, ${context.length} caracteres.`);
  return context;
}

module.exports = { getPrivateContextForAgent };
