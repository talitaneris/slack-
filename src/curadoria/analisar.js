// Análise de IA das notícias do dia — gera pautas quentes com ângulo de posicionamento da Talita.
// Se a API falhar (saldo, timeout, JSON inválido), monta um fallback local para a seção não ficar vazia.

const { callClaudeFastDetailed } = require('../claude');
const { assess } = require('./relevance');
const { cleanText } = require('./text');

const SYSTEM_ANALISAR = `
Você é um estrategista de conteúdo da Talita Neris — estrategista de crescimento de negócios para empreendedoras digitais.

POSICIONAMENTO:
Talita não é especialista em Instagram, não é coach de comunicação, não é professora de marketing.
Ela é estrategista de crescimento de negócios. Tese: "Crescimento é extrair o que já existe — não fazer mais."
Posição pública: "A verdade vende" — nomeie o fato incômodo, sem motivacional.
ICP: empreendedora digital, 25–45 anos, negócio ativo com faturamento mas sem crescimento proporcional ao esforço.

FUNÇÃO:
Analisar notícias e tendências do dia e identificar as pautas mais relevantes para o ICP da Talita.
Para cada pauta: dizer por que o ICP se importa, qual o ângulo de posicionamento da Talita, e sugerir um hook direto.

REGRAS DE VOZ (inegociável):
— Nenhuma palavra proibida: transformação, jornada, empoderar, audiência, engajamento, presença digital, receita real, real (adjetivo), estrutura (em copy), sinergia, inovador, holístico, robusto, mindset, ecossistema, catalisador, tração, visibilidade (como objetivo), potencializar, próximo nível, sua melhor versão
— Sem frases de transição de IA: "É importante destacar", "Vale ressaltar", "Em suma", "Portanto", "Além disso"
— Hook: diagnóstico direto ou inversão. Nunca pergunta motivacional. Nunca começa com saudação.
— Específico bate genérico: nomeia a dor exata, não a categoria da dor
— Cada campo com no máximo 240 caracteres
`.trim();

const PAUTA_FIELDS = ['titulo', 'fonte', 'relevancia', 'angulo', 'hook'];

function classifyClaudeError(err) {
  const message = String(err?.message || '');
  if (/credit balance is too low/i.test(message)) return 'saldo Anthropic esgotado';
  if (err?.status === 401 || /authentication|invalid x-api-key|invalid api key/i.test(message)) return 'chave Anthropic recusada';
  if (err?.status === 429 || /rate limit/i.test(message)) return 'limite de taxa da API';
  if (err?.status === 404 || /not_found_error|model:/i.test(message)) return 'modelo de IA indisponível';
  if (/timeout|aborted|timed out/i.test(message)) return 'timeout na API';
  if (err?.status) return `HTTP ${err.status}`;
  return 'erro inesperado';
}

function timestamp(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function rankArticles(articles) {
  return articles
    .map((article) => {
      const verdict = assess(article.title || '', '', article.summary || '');
      return {
        article,
        score: verdict.score,
        portuguese: verdict.lang === 'pt' ? 1 : 0,
        time: timestamp(article.date),
      };
    })
    .sort((a, b) => b.portuguese - a.portuguese || b.score - a.score || b.time - a.time)
    .map((entry) => entry.article);
}

function diverseArticles(articles, limit) {
  const ranked = rankArticles(articles);
  const picked = [];
  const perSource = {};
  for (const article of ranked) {
    perSource[article.source] = perSource[article.source] || 0;
    if (perSource[article.source] >= 2) continue;
    picked.push(article);
    perSource[article.source] += 1;
    if (picked.length >= limit) return picked;
  }
  for (const article of ranked) {
    if (picked.includes(article)) continue;
    picked.push(article);
    if (picked.length >= limit) break;
  }
  return picked;
}

function parsePautasJson(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  if (start < 0) return null;
  const slice = cleaned.slice(start);
  try {
    return JSON.parse(slice);
  } catch {
    /* resposta cortada no meio do JSON */
  }
  const lastObject = slice.lastIndexOf('}');
  if (lastObject > 0) {
    try {
      return JSON.parse(`${slice.slice(0, lastObject + 1)}]`);
    } catch {
      return null;
    }
  }
  return null;
}

function sanitizePautas(items, fallback) {
  if (!Array.isArray(items)) return [];
  const pautas = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const pauta = { fallback };
    let complete = true;
    for (const field of PAUTA_FIELDS) {
      const value = cleanText(item[field], 400);
      if (!value) complete = false;
      pauta[field] = value;
    }
    if (!complete) continue;
    pautas.push(pauta);
    if (pautas.length === 5) break;
  }
  return pautas;
}

function clip(text, max) {
  const value = cleanText(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

const BUCKETS = [
  {
    test: /\b(ia|intelig[eê]ncia artificial|chatgpt|openai|algoritmo|automa)/i,
    titulo: (article) => `IA só serve se encurtar o que já vende: ${clip(article.title, 64)}`,
    relevancia: (article) => `Quem já tem oferta e cliente vai ler "${clip(article.title, 80)}" e achar que falta mais uma ferramenta. O furo é não saber qual etapa atual essa ferramenta tira do caminho.`,
    angulo: () => 'Talita lê IA como extração. Se a ferramenta não diminui o esforço de uma venda que já existe, ela só aumenta a lista de coisa para fazer.',
    hook: (article) => `Não comece pela ferramenta. Comece pela venda que já acontece e ainda depende de você. ${clip(article.title, 70)}`,
  },
  {
    test: /\b(campanha|an[uú]ncio|publicidade|branding|parceria|collab)/i,
    titulo: (article) => `Campanha bonita não corrige oferta torta: ${clip(article.title, 58)}`,
    relevancia: (article) => `A empreendedora vê "${clip(article.title, 70)}" e compara a peça da marca grande com o story dela. A peça não substitui uma oferta clara.`,
    angulo: () => 'Talita usa a campanha alheia como espelho: o que essa marca escolheu dizer, e o que a empreendedora ainda está evitando dizer sobre o próprio negócio.',
    hook: (article) => `A peça ficou pronta. A oferta, não. É aí que o orçamento some. ${clip(article.title, 70)}`,
  },
  {
    test: /\b(instagram|tiktok|reels|creator|criador|influenc|youtube|whatsapp|rede social|redes sociais)/i,
    titulo: (article) => `O canal não é a estratégia: ${clip(article.title, 72)}`,
    relevancia: (article) => `"${clip(article.title, 80)}" mexe com quem posta todo dia e mesmo assim não vê o faturamento acompanhar. O ponto é onde o conteúdo atual para de virar venda.`,
    angulo: () => 'Talita não ensina a postar mais. O ângulo é mostrar qual parte da oferta já existe e ainda não está sendo dita com clareza nesse canal.',
    hook: (article) => `Postar mais não destravou quem já posta. O que falta é a oferta que esse conteúdo deveria vender. ${clip(article.title, 60)}`,
  },
  {
    test: /\b(comportamento|tend[eê]ncia|consumo)\b/i,
    titulo: (article) => `O cliente já mudou. A oferta, não: ${clip(article.title, 62)}`,
    relevancia: (article) => `"${clip(article.title, 80)}" descreve um hábito que a empreendedora ainda trata como exceção. Quem já compra dela também está nesse movimento.`,
    angulo: () => 'Talita não comenta pesquisa. Ela aponta a oferta que já existe e que fica fora do hábito que a notícia descreve.',
    hook: (article) => `O hábito do cliente mudou. A oferta que você já tem ainda fala com o hábito antigo. ${clip(article.title, 55)}`,
  },
  {
    test: /\b(venda|vender|fatur|pre[cç]o|precif|cliente|consumidor|varejo|e-?commerce|black friday|convers)/i,
    titulo: (article) => `Venda que já existe, esforço que não cabe: ${clip(article.title, 58)}`,
    relevancia: (article) => `"${clip(article.title, 80)}" fala com quem fatura e continua sem crescimento proporcional. O ponto é o cliente que já comprou e ainda não foi conduzido de novo.`,
    angulo: () => 'Crescimento, aqui, é extrair o que já existe: o cliente, o preço e a oferta que já funcionam — sem abrir mais uma frente.',
    hook: (article) => `Antes de buscar cliente novo, olhe quem já pagou e não foi convidado a comprar de novo. ${clip(article.title, 55)}`,
  },
  {
    test: /\b(mei|pequeno|empreend|startup|gest[aã]o|sebrae|neg[oó]cio)/i,
    titulo: (article) => `Negócio ativo, crescimento parado: ${clip(article.title, 64)}`,
    relevancia: (article) => `Para quem já tem empresa e trabalha demais, "${clip(article.title, 70)}" não é curiosidade. É o risco de reagir fazendo mais uma coisa.`,
    angulo: () => 'Talita puxa a notícia para a operação atual: o que já existe no negócio e ainda não está sendo conduzido. Mais tarefa não é a resposta.',
    hook: (article) => `O negócio não travou por falta de ideia. Travou porque o que já vende ainda depende demais de você. ${clip(article.title, 50)}`,
  },
];

const DEFAULT_BUCKET = {
  titulo: (article) => `O fato, sem enfeite: ${clip(article.title, 78)}`,
  relevancia: (article) => `"${clip(article.title, 90)}" cruza o dia de quem já tem negócio e sente que precisa reagir. Reagir fazendo mais é o reflexo que custa caro.`,
  angulo: () => 'A verdade vende quando o fato é nomeado sem motivacional: o que essa notícia expõe no negócio que já existe, e o que não precisa ser criado do zero.',
  hook: (article) => `Você não precisa de um plano novo. Precisa conduzir o que essa notícia mostra que já está na sua frente. ${clip(article.title, 50)}`,
};

function fallbackFromArticle(article) {
  const text = `${article.title} ${article.summary || ''}`;
  const bucket = BUCKETS.find((item) => item.test.test(text)) || DEFAULT_BUCKET;
  return {
    titulo: bucket.titulo(article),
    fonte: article.source,
    relevancia: bucket.relevancia(article),
    angulo: bucket.angulo(article),
    hook: bucket.hook(article),
    fallback: true,
  };
}

function fallbackPautas(articles) {
  const pautas = [];
  const used = new Set();
  for (const article of articles) {
    if (pautas.length >= 5) break;
    const key = `${article.source}|${article.title}`;
    if (used.has(key)) continue;
    used.add(key);
    pautas.push(fallbackFromArticle(article));
  }
  return pautas;
}

function completePautas(primary, articles) {
  if (primary.length >= 5) return primary.slice(0, 5);
  const merged = primary.slice();
  const hooks = new Set(merged.map((pauta) => pauta.hook));
  for (const pauta of fallbackPautas(articles)) {
    if (merged.length >= 5) break;
    if (hooks.has(pauta.hook)) continue;
    merged.push(pauta);
    hooks.add(pauta.hook);
  }
  return merged;
}

async function gerarPautas(articles) {
  const selected = diverseArticles(articles || [], 12);
  if (!selected.length) {
    console.warn('Pautas: nenhum artigo relevante para gerar ângulos.');
    return [];
  }

  const lista = selected
    .map((article, index) => `${index + 1}. [${article.source}] ${article.title}\n   ${article.summary || ''}`)
    .join('\n\n');

  const prompt = `
Aqui estão as notícias e tendências do dia (${new Date().toLocaleDateString('pt-BR')}):

${lista}

Selecione as 5 pautas mais relevantes para o ICP da Talita Neris (empreendedoras com negócio ativo mas crescimento travado).
Ignore política, loteria, esporte, fofoca e macroeconomia sem ligação com o negócio dela.

Para cada pauta, entregue exatamente neste formato JSON (array de 5 objetos):

[
  {
    "titulo": "título direto da pauta (não o título do artigo — o ângulo para o ICP)",
    "fonte": "nome da fonte original",
    "relevancia": "por que o ICP da Talita se importa com isso (1 frase, específica)",
    "angulo": "como Talita se posiciona sobre esse tema (1-2 frases, na voz dela)",
    "hook": "hook pronto para Stories ou Reel (1-2 frases, diagnóstico direto ou inversão, nunca pergunta motivacional)"
  }
]

Responda SOMENTE com o JSON. Sem texto antes ou depois.
`.trim();

  try {
    const { text, stopReason } = await callClaudeFastDetailed(SYSTEM_ANALISAR, prompt, 2000);
    if (stopReason === 'max_tokens') {
      console.warn('Pautas: resposta da IA truncada (max_tokens). Tentando recuperar o JSON.');
    }
    const parsed = parsePautasJson(text);
    const clean = sanitizePautas(parsed, false);
    if (clean.length >= 3) {
      const pautas = completePautas(clean, selected);
      console.log(`Pautas: IA gerou ${clean.length}.`);
      return pautas;
    }
    const preview = cleanText(text, 160);
    console.warn(`Pautas: IA devolveu JSON inválido ou curto (${clean.length}). Amostra: ${preview || 'vazia'}`);
  } catch (err) {
    console.warn(`Pautas: geração por IA falhou (${classifyClaudeError(err)}).`);
  }

  const fallback = fallbackPautas(selected);
  console.warn(`Pautas: fallback local com ${fallback.length} pautas.`);
  return fallback;
}

module.exports = { gerarPautas, parsePautasJson, fallbackPautas, classifyClaudeError };
