'use strict';

const { AGENTS } = require('../agents');
const { callClaude, callClaudeWithHistory, callClaudeFast } = require('../claude');
const { processMariahCalendar } = require('../handlers/mariah');
const { buildMariahMemoryContext, registrarNaMemoria } = require('../memory/mariah');
const { readMariahMemory, writeMariahMemory } = require('../memory/index');
const { getPrivateContextForAgent } = require('../privateContext');
const { listarEventos } = require('../services/calendar');
const { listarEmailsManha, isEmailConfigured, enviarEmail } = require('../services/email');
const { criarReuniaoZoom, isZoomConfigured } = require('../services/zoom');

const TELEGRAM_API = 'https://api.telegram.org';

// ─── CONFIGURAÇÃO DE CANAIS ───────────────────────────────────
// Cada canal do Telegram tem um modo: geral | conteudo | negocio | financeiro | pessoal
// Env: TELEGRAM_CHANNELS=chatid1:geral,chatid2:conteudo,chatid3:financeiro
// Fallback: TELEGRAM_ALLOWED_CHAT_ID (modo geral, comportamento original)

const CHANNEL_MODES = {
  geral: {
    label: 'Principal',
    agentKey: 'assistente',
    extraPrompt: '',
  },
  conteudo: {
    label: 'Conteúdo',
    agentKey: 'people',
    extraPrompt: [
      'MODO: Canal de Conteúdo.',
      'Foco: criação de conteúdo, Instagram, TikTok, Reels, carrosséis, hooks magnéticos, legendas, calendário editorial, roteiros.',
      'Responda como People — criativa, orientada a engajamento.',
      'Quando pedirem hooks: entregue 4 tipos (atração, autoridade, conexão, venda).',
      'Quando pedirem carrossel: estruture slide a slide com gancho, desenvolvimento e CTA.',
      'Quando pedirem roteiro: abertura 3s + desenvolvimento + CTA.',
      'Sem emoji. Formato limpo e acionável.',
    ].join('\n'),
  },
  negocio: {
    label: 'Negócio',
    agentKey: 'jay',
    extraPrompt: [
      'MODO: Canal de Negócio.',
      'Foco: estratégia comercial, pipeline, receita, A Base, evento, metas dos 4 focos.',
      'Responda como Jay — analítico, orientado a resultado e número.',
      'Cada resposta deve ter impacto claro na receita ou na meta.',
      'Sem emoji. Direto e acionável.',
    ].join('\n'),
  },
  financeiro: {
    label: 'Financeiro',
    agentKey: 'assistente',
    extraPrompt: [
      'MODO: Canal Financeiro.',
      'Foco: controle de caixa, MRR, pagamentos, inadimplência, fluxo, contratos.',
      'Seja analítica e precisa. Organize informações financeiras em formato claro.',
      'Nunca invente número. Se não tiver dado confirmado, diga e proponha como obter.',
      'Sem emoji. Tabela ou bullets quando necessário.',
    ].join('\n'),
  },
  pessoal: {
    label: 'Pessoal',
    agentKey: 'assistente',
    extraPrompt: [
      'MODO: Canal Pessoal.',
      'Foco: rotina de saúde, família, agenda pessoal, bem-estar, lembretes de vida fora do trabalho.',
      'Seja leve e cuidadosa — esse canal é sobre vida, não negócio.',
      'Pode ser mais informal, mas mantenha clareza e objetividade.',
      'Sem emoji.',
    ].join('\n'),
  },
  receitas: {
    label: 'Receitas',
    agentKey: 'jay',
    extraPrompt: [
      'MODO: Canal de Receita Financeira.',
      'Foco: faturamento, MRR, receita confirmada, parcelas recebidas, projeções de receita, inadimplência.',
      'Responda como Jay — analítico, orientado a número real.',
      'Nunca invente valor. Se não tiver dado confirmado, diga e proponha como obter.',
      'Organize em: Receita confirmada / A receber / Risco de inadimplência / Projeção do mês.',
      'Sem emoji. Use tabela quando tiver múltiplos valores.',
    ].join('\n'),
  },
  ads: {
    label: 'Ads',
    agentKey: 'assistente',
    extraPrompt: [
      'MODO: Canal de Tráfego Pago.',
      'Foco: Meta Ads, Google Ads, criativos, público, orçamento, CPL, CPA, ROAS, funil de anúncios.',
      'Seja analítica e orientada a resultado. Cada decisão deve ter impacto claro em custo ou conversão.',
      'Quando pedirem criativo: entregue copy de anúncio com hook, corpo e CTA.',
      'Quando pedirem análise: identifique o que está drenando orçamento e o que está convertendo.',
      'Sem emoji. Direto e acionável.',
    ].join('\n'),
  },
  pendencias: {
    label: 'Pendências',
    agentKey: 'assistente',
    extraPrompt: [
      'MODO: Canal de Pendências.',
      'Foco: to-dos, follow-ups, cobranças, tarefas abertas, prazos, o que está travado e com quem.',
      'Organize sempre por: urgência (hoje / esta semana / sem prazo) e dono (Talita / agente / terceiro).',
      'Quando Talita listar pendências: organize, priorize e proponha quem resolve cada uma.',
      'Quando pedir status: resuma o que ainda está aberto e o que precisa de decisão.',
      'Sem emoji. Formato de lista limpa.',
    ].join('\n'),
  },
  numeros: {
    label: 'Números',
    agentKey: 'jay',
    extraPrompt: [
      'MODO: Canal de Métricas.',
      'Foco: KPIs do negócio, conversão, ticket médio, churn, LTV, taxa de renovação, crescimento mês a mês.',
      'Responda como Jay — orientado a diagnóstico e decisão baseada em dado.',
      'Quando receber números: identifique o que está abaixo do esperado e qual alavanca mover.',
      'Nunca invente métrica. Se o dado não vier, aponte qual dado falta e quem deve levantar.',
      'Sem emoji. Tabela ou bullets quando necessário.',
    ].join('\n'),
  },
  produtos: {
    label: 'Produtos',
    agentKey: 'assistente',
    extraPrompt: [
      'MODO: Canal de Produto.',
      'Foco: A Base, estrutura de aulas, jornada das mentoradas, material didático, entregas, onboarding, renovação.',
      'Pense como Paulo — orientado à experiência da mentorada e à entrega de resultado.',
      'Quando pedirem estrutura de aula: entregue objetivo, exercício prático e pergunta de reflexão.',
      'Quando pedirem diagnóstico: identifique onde a mentorada está travada e o que destravar.',
      'Sem emoji. Foco em clareza e aplicação.',
    ].join('\n'),
  },
  viagem: {
    label: 'Viagem',
    agentKey: 'assistente',
    extraPrompt: [
      'MODO: Canal de Viagem.',
      'Foco: planejamento de viagens, roteiros, passagens, hospedagem, aluguel de carro, malas, documentos, dicas de destino.',
      'Seja prática e detalhista. Antecipe o que Talita vai precisar antes de ela perguntar.',
      'Quando pedirem roteiro: organize por dia com horários, deslocamentos e reservas necessárias.',
      'Quando pedirem checklist: cubra documentos, mala, reservas, câmbio e seguros.',
      'Sem emoji. Formato de lista ou tabela.',
    ].join('\n'),
  },
  casamento: {
    label: 'Casamentos',
    agentKey: 'assistente',
    extraPrompt: [
      'MODO: Canal de Casamentos das Amigas.',
      'Contexto: Talita vai a dois casamentos de amigas — um no sul da Argentina, outro no sul do Brasil.',
      'Foco: planejamento completo de cada evento — viagem, hospedagem, aluguel de carro, roupa para cada cerimônia, presentes, câmbio (Argentina), documentos, logística.',
      'Trate os dois eventos separadamente: Argentina e Brasil sul.',
      'Antecipe: passagem, roupa adequada para cada cerimônia, presente, câmbio para Argentina.',
      'Quando pedirem lista: separe por evento e por categoria (viagem / roupa / presente / logística).',
      'Seja leve e animada com o assunto — são festas de amigas, não reunião de negócio.',
      'Sem emoji.',
    ].join('\n'),
  },
  dia_a_dia: {
    label: 'Dia a Dia',
    agentKey: 'assistente',
    extraPrompt: [
      'MODO: Canal Dia a Dia.',
      'Foco: rotina diária, hábitos, compras do dia a dia, restaurantes, tarefas domésticas, pequenas decisões cotidianas.',
      'Seja prática e rápida — esse canal é para o que não cabe em nenhum outro.',
      'Quando pedirem sugestão de restaurante: considere localização, tipo de refeição e com quem vai.',
      'Quando pedirem lista de compras: organize por categoria (mercado, farmácia, etc.).',
      'Pode ser mais informal. Sem emoji.',
    ].join('\n'),
  },
};

function parseChannelConfig() {
  const raw = process.env.TELEGRAM_CHANNELS;
  const map = new Map();

  if (raw) {
    for (const entry of raw.split(',')) {
      const [id, mode] = entry.trim().split(':');
      if (id && mode && CHANNEL_MODES[mode]) {
        map.set(String(id.trim()), mode.trim());
      }
    }
  }

  // Fallback para variável legada — canal principal no modo geral
  const legacy = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (legacy && !map.has(String(legacy))) {
    map.set(String(legacy), 'geral');
  }

  return map;
}

// Cache do mapa de canais (não muda em runtime)
const _channelConfig = parseChannelConfig();

function getChannelMode(chatId) {
  if (_channelConfig.size === 0) return 'geral'; // sem restrição configurada
  return _channelConfig.get(String(chatId)) || null; // null = não permitido
}

// ─── COORDENAÇÃO COM O SQUAD ──────────────────────────────────

const AGENT_CHANNEL_MAP = {
  nara:   { channel: 'C0AN20EFA02', label: 'Nara' },
  jay:    { channel: 'C03PX3KKTJS', label: 'Jay' },
  people: { channel: 'C0AMR167B4L', label: 'People' },
  vega:   { channel: 'C0AMR167B4L', label: 'Vega' },
  lia:    { channel: 'C0AMJ13D85T', label: 'Lia' },
  mari:   { channel: 'C0AMR126AN8', label: 'Mari' },
  paulo:  { channel: 'C0AMR126AN8', label: 'Paulo' },
  alex:   { channel: 'C0AMR167B4L', label: 'Alex' },
};

let _slackClient = null;

// ─── HISTÓRICO DE CONVERSA PERSISTENTE ───────────────────────
// Cache em memória para velocidade + Supabase para durabilidade entre sessões.
// Sobrevive reinicializações do Render — Mariah retoma o contexto de onde parou.
const _conversationHistory = new Map();
const _historyLoaded = new Set(); // chatIds já carregados nesta sessão
const HISTORY_MAX_PAIRS = 25; // 25 trocas = 50 mensagens — contexto de um dia inteiro

function historyKey(chatId) {
  return `history_${String(chatId)}`;
}

async function ensureHistoryLoaded(chatId) {
  if (!chatId) return;
  const id = String(chatId);
  if (_historyLoaded.has(id)) return;
  _historyLoaded.add(id);

  try {
    const raw = await readMariahMemory(historyKey(chatId));
    if (raw && raw.trim()) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        _conversationHistory.set(id, parsed);
      }
    }
  } catch {}

  if (!_conversationHistory.has(id)) _conversationHistory.set(id, []);
}

function getHistory(chatId) {
  if (!chatId) return [];
  return [...(_conversationHistory.get(String(chatId)) || [])];
}

function pushToHistory(chatId, role, content) {
  if (!chatId) return;
  const id = String(chatId);
  const hist = _conversationHistory.get(id) || [];
  hist.push({ role, content: String(content).slice(0, 1500) });
  if (hist.length > HISTORY_MAX_PAIRS * 2) hist.splice(0, 2);
  _conversationHistory.set(id, hist);
  // Persiste por canal — cada chatId tem seu próprio histórico
  writeMariahMemory(historyKey(id), JSON.stringify(hist)).catch(() => {});
}

function isPassandoTrabalhoParaTalita(texto) {
  const lower = normalizeText(texto);
  return [
    'voce precisa verificar', 'voce precisa confirmar', 'voce precisa checar',
    'voce deve entrar em contato', 'voce pode verificar', 'voce pode confirmar',
    'sugiro que voce', 'recomendo que voce', 'peço que voce', 'peco que voce',
    'talita precisa', 'talita deve', 'voce deveria ligar', 'voce deveria enviar',
  ].some(t => lower.includes(t));
}

async function detectarEDelegarSquad(userText, mariahResponse, logger) {
  if (!_slackClient) return;

  // Gatilho: Mariah jogou trabalho de volta pra Talita quando podia delegar
  if (isPassandoTrabalhoParaTalita(mariahResponse)) {
    try {
      const correcao = await callClaudeFast(
        'Você é a Mariah. Identifique o que nessa resposta deveria ir para um agente do squad em vez de voltar para Talita. Retorne JSON: {"agente":"nome do agente dono","tarefa":"o que fazer em 1 frase"}. Se não houver delegação possível, retorne null.',
        `Resposta problemática: "${mariahResponse.slice(0, 500)}"`,
        150
      );
      const parsed = JSON.parse(correcao.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      if (parsed?.agente && parsed?.tarefa) {
        const key = parsed.agente.toLowerCase().trim();
        const mapping = AGENT_CHANNEL_MAP[key];
        if (mapping) {
          await _slackClient.chat.postMessage({
            channel: mapping.channel,
            text: `*Mariah → ${mapping.label}*\n${parsed.tarefa}`,
          });
          logger?.info(`[gatilho-redirect] Trabalho redirecionado de Talita → ${mapping.label}`);
        }
      }
    } catch {}
  }

  const lower = mariahResponse.toLowerCase();
  const mencionados = Object.keys(AGENT_CHANNEL_MAP).filter(n => lower.includes(n));
  if (mencionados.length === 0) return;

  try {
    const raw = await callClaudeFast(
      'Você extrai delegações reais de respostas da Mariah. Retorne apenas JSON válido, sem markdown.',
      `Mensagem da Talita: "${userText.slice(0, 300)}"\nResposta da Mariah: "${mariahResponse.slice(0, 600)}"\n\nExtrai apenas delegações reais para o squad. Se a menção for só contextual (ex: "Nara já resolveu"), ignore.\nRetorne JSON: [{"agente":"nome","tarefa":"o que fazer em 1 frase direta"}]\nSe não há delegação real, retorne [].`,
      250
    );
    const json = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const delegacoes = JSON.parse(json);
    if (!Array.isArray(delegacoes)) return;

    for (const d of delegacoes) {
      const key = (d.agente || '').toLowerCase().trim();
      const mapping = AGENT_CHANNEL_MAP[key];
      if (!mapping || !d.tarefa) continue;
      await _slackClient.chat.postMessage({
        channel: mapping.channel,
        text: `*Mariah → ${mapping.label}*\n${d.tarefa}`,
      });
      logger?.info(`[mariah-coord] → ${mapping.label}: ${String(d.tarefa).slice(0, 80)}`);
    }
  } catch (err) {
    logger?.warn('[mariah-coord] Erro ao coordenar squad:', err.message);
  }
}

// ─── GATILHO 1: NOVO CLIENTE / FECHAMENTO ────────────────────

function isNovoClienteGatilho(text) {
  const lower = normalizeText(text);
  return [
    'fechou', 'cliente novo', 'nova cliente', 'nova mentorada', 'novo mentorado',
    'assinou', 'entrou no grupo', 'entrou na mentoria', 'pagou', 'comprou',
    'confirmou pagamento', 'cliente fechou', 'fechamento confirmado',
  ].some(t => lower.includes(t));
}

async function acionarOnboarding(userText, chatId, logger) {
  try {
    const nome = await callClaudeFast(
      'Extraia apenas o nome do cliente ou mentorada mencionado. Se não houver nome claro, retorne "novo cliente". Retorne só o nome, sem mais texto.',
      userText.slice(0, 300),
      30
    );
    const nomeCliente = nome.trim();

    if (_slackClient) {
      await _slackClient.chat.postMessage({
        channel: 'C0AMR126AN8', // Mari — atendimento
        text: `*Mariah → Mari*\nNovo cliente confirmado: ${nomeCliente}.\nAções: criar acesso, enviar boas-vindas, agendar kickoff.`,
      });
      await _slackClient.chat.postMessage({
        channel: 'C0AMJ13D85T', // Lia — vendas
        text: `*Mariah → Lia*\nFechamento confirmado: ${nomeCliente}. Registrar no pipeline e marcar como ganho.`,
      });
    }

    await sendTelegramMessage(chatId, `Onboarding acionado para ${nomeCliente}. Mari e Lia foram avisadas.`);
    logger?.info(`[gatilho-cliente] Onboarding acionado: ${nomeCliente}`);
  } catch (err) {
    logger?.error('[gatilho-cliente] Erro:', err.message);
  }
}

function getBrtNow() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

function formatForTelegram(text) {
  if (!text) return '';
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '*$1*')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3800);
}

async function telegramRequest(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN ausente');
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram ${method} falhou: ${response.status} ${body.slice(0, 200)}`);
  }
  return response.json();
}

async function setTelegramWebhook(publicBaseUrl, logger) {
  if (!logger) logger = console;
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    logger.warn('Telegram webhook nao configurado: TELEGRAM_BOT_TOKEN ausente.');
    return;
  }
  const baseUrl = (publicBaseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    logger.warn('Telegram webhook nao configurado: URL publica ausente.');
    return;
  }
  const payload = {
    url: `${baseUrl}/telegram/webhook`,
    allowed_updates: ['message', 'edited_message'],
  };
  if (process.env.TELEGRAM_WEBHOOK_SECRET) {
    payload.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
  }
  try {
    const result = await telegramRequest('setWebhook', payload);
    logger.info(`Telegram webhook configurado: ${JSON.stringify(result).slice(0, 220)}`);
  } catch (err) {
    logger.error(`Erro ao configurar Telegram webhook: ${err.message}`);
  }
}

async function sendTelegramMessage(chatId, text) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text: formatForTelegram(text),
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
}

async function sendTelegramVoice(chatId, audioBuffer, mimeType = 'audio/ogg; codecs=opus') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const isOgg = mimeType.includes('ogg');
  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  if (isOgg) {
    formData.append('voice', new Blob([audioBuffer], { type: mimeType }), 'voice.ogg');
    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendVoice`, { method: 'POST', body: formData });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`sendVoice falhou: ${response.status} ${body.slice(0, 200)}`);
    }
    return response.json();
  } else {
    formData.append('audio', new Blob([audioBuffer], { type: mimeType }), 'mariah.mp3');
    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendAudio`, { method: 'POST', body: formData });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`sendAudio falhou: ${response.status} ${body.slice(0, 200)}`);
    }
    return response.json();
  }
}

function cleanTextForSpeech(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^[-•]\s*/gm, '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ', ')
    .trim();
}

async function convertMp3ToOgg(mp3Buffer) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-f', 'ogg',
      'pipe:1',
    ]);
    const chunks = [];
    ff.stdout.on('data', chunk => chunks.push(chunk));
    ff.stdout.on('end', () => resolve(Buffer.concat(chunks)));
    ff.stderr.on('data', () => {});
    ff.on('error', reject);
    ff.stdin.write(mp3Buffer);
    ff.stdin.end();
  });
}

async function textToSpeechElevenLabs(spokenText) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Sarah

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: spokenText.slice(0, 5000),
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.80 },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`ElevenLabs TTS falhou: ${response.status} ${err.slice(0, 200)}`);
  }

  const mp3Buffer = Buffer.from(await response.arrayBuffer());
  try {
    const oggBuffer = await convertMp3ToOgg(mp3Buffer);
    return { buffer: oggBuffer, mime: 'audio/ogg; codecs=opus' };
  } catch {
    // ffmpeg unavailable — send MP3 directly via sendAudio
    return { buffer: mp3Buffer, mime: 'audio/mpeg' };
  }
}

async function textToSpeechGoogle(spokenText) {
  const googleKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_API_KEY;
  const body = {
    input: { text: spokenText.slice(0, 4000) },
    voice: { languageCode: 'pt-BR', name: 'pt-BR-Neural2-C', ssmlGender: 'FEMALE' },
    audioConfig: { audioEncoding: 'OGG_OPUS' },
  };
  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(`Google TTS falhou: ${JSON.stringify(data).slice(0, 200)}`);
  return { buffer: Buffer.from(data.audioContent, 'base64'), mime: 'audio/ogg; codecs=opus' };
}

async function textToSpeech(text) {
  const spokenText = cleanTextForSpeech(text);
  if (process.env.ELEVENLABS_API_KEY) {
    return textToSpeechElevenLabs(spokenText);
  }
  return textToSpeechGoogle(spokenText);
}

function normalizeText(text) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function shouldRespondWithVoice(userText, sourceIsVoice) {
  if (sourceIsVoice) return true;
  const lower = normalizeText(userText);
  const voiceRequests = [
    'responde em audio', 'manda audio', 'quero ouvir',
    'fala pra mim', 'me manda audio', 'resposta em audio',
    'audio por favor', 'em voz', 'me fala', 'responder em audio',
    'responde audio', 'manda em audio', 'em audio',
  ];
  if (voiceRequests.some(t => lower.includes(t))) return true;
  const textTriggers = [
    'lista', 'checklist', 'tarefas', 'pendencias', 'agenda',
    'reuniao', 'horario', 'relatorio', 'dados', 'numeros',
    'email', 'e-mail', 'inbox', 'caixa'
  ];
  if (textTriggers.some(t => lower.includes(t))) return false;
  const voiceTriggers = [
    'como voce esta', 'to bem', 'cansada', 'animada',
    'preocupada', 'feliz', 'triste', 'preciso conversar',
    'me ajuda', 'o que voce acha', 'sua opiniao'
  ];
  if (voiceTriggers.some(t => lower.includes(t))) return true;
  return false;
}

async function buildMariahSystem(channelMode = 'geral') {
  const modeConfig = CHANNEL_MODES[channelMode] || CHANNEL_MODES.geral;
  const agent = AGENTS[modeConfig.agentKey] || AGENTS.assistente;

  const baseLines = [
    'Agora em America/Sao_Paulo: ' + getBrtNow() + '.',
    'CANAL: Telegram. Voce e a Mariah, agente executiva da Talita.',
    'Telegram e porta de entrada rapida: mensagem curta, audio, ideia solta, comando pessoal, rotina.',
    'Formato preferido: Entendi / Vou organizar assim / Depende de voce apenas se houver decisao sua.',
    '',
    'MANDATO — ALCADAS DE DECISAO:',
    'FAZ SOZINHA (rotina, triagem, padrao conhecido): filtrar email, organizar agenda, preparar contexto do dia, resumos, checklist, cobrar squad, link Zoom, registrar memoria, dizer "isso nao precisa de voce".',
    'AVISA ANTES (impacto medio ou envolve terceiro): reagendar com cliente, responder em nome da Talita, aprovar conteudo, envolver lead ou parceiro, qualquer acao que gere expectativa em outra pessoa.',
    'FINANCEIRO OPERACIONAL: controle bancario, fluxo de caixa, conciliacao, pagamentos recorrentes, fechamento mensal. Mariah organiza e apresenta resumo claro. Reporta a Talita so o que exigir decisao.',
    'NAO TOCA (estrategico, pessoal — sao dela): contratar, demitir, assinar contrato, posicionamento publico, oferta, preco, decisao de produto, resposta sensivel a mentorada em crise.',
    '',
    'IMPORTANTE: Voce TEM acesso ao email da Talita via Zoho Mail API e ao Google Calendar.',
    'ESTILO: nao use emoji. Nao use titulo com seu nome nem titulo de briefing. Nao use texto corporativo grande. Responda curto, humano e acionavel.',
    'PROIBIDO: cumprimentar ("Oi Talita", "Ola", "Bom dia"). Voce ja esta na conversa — va direto ao ponto.',
    'PROIBIDO: dizer que nao tem acesso ao Zoho se o contexto trouxer e-mails da Zoho. Se houver erro tecnico, diga "a consulta falhou" e acione Nara.',
    'PROIBIDO: explicar seu proprio comportamento. Nao diga quando voce vai responder em audio, quando voce vai usar qual canal, o que voce pode ou nao pode fazer.',
    'PROIBIDO: se justificar. Nao use frases como "Entendi, vou responder em audio quando...", "Lembro que aqui no Telegram...", "Como agente executiva...". Age, nao explica.',
    'PROIBIDO: perguntar confirmacao do obvio. Se o pedido for claro, executa. Pergunta so quando a decisao for da Talita.',
    'PROIBIDO: perguntar o que a mensagem quis dizer quando o contexto for suficiente. Interpreta e age. Se faltou algo essencial, faz uma pergunta unica e direta.',
    '',
    agent.system,
  ];

  if (modeConfig.extraPrompt) baseLines.push('', modeConfig.extraPrompt);

  let system = baseLines.join('\n');

  try {
    const privateContext = await getPrivateContextForAgent(agent.key);
    if (privateContext && privateContext.trim()) {
      system = system + '\n\n' + privateContext;
    }
  } catch (e) {}

  try {
    const memoryContext = await buildMariahMemoryContext();
    if (memoryContext) {
      system = system + '\n\n' + memoryContext;
    }
  } catch (e) {}

  const milestones = getMilestoneContext();
  if (milestones) system = system + '\n\n' + milestones;

  return system;
}

function getBrtDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const value = type => parts.find(part => part.type === type)?.value;
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
  };
}

function getBrtTodayRange() {
  const { year, month, day } = getBrtDateParts();
  return {
    start: new Date(`${year}-${month}-${day}T00:00:00-03:00`),
    end: new Date(`${year}-${month}-${day}T23:59:59-03:00`),
    label: `${day}/${month}/${year}`,
  };
}

// ─── MILESTONES — prazos fixos do negócio ────────────────────

const MILESTONES = [
  { label: 'Turma 1 A Base começa', date: '2026-06-09' },
  { label: 'Evento (04/07)', date: '2026-07-04' },
  { label: 'Turma 2 A Base começa', date: '2026-08-11' },
  { label: 'Turma 3 A Base começa', date: '2026-10-13' },
  { label: 'Turma 3 A Base encerra', date: '2026-12-22' },
];

function getMilestoneContext() {
  const now = new Date();
  const upcoming = MILESTONES
    .map(m => ({ ...m, dias: Math.ceil((new Date(m.date + 'T00:00:00-03:00') - now) / (1000 * 60 * 60 * 24)) }))
    .filter(m => m.dias >= 0 && m.dias <= 60)
    .sort((a, b) => a.dias - b.dias);
  if (upcoming.length === 0) return '';
  return 'PRAZOS DO NEGÓCIO (use para contextualizar urgência):\n' +
    upcoming.map(m => `• ${m.label}: ${m.dias} dia(s)`).join('\n');
}

// ─── DETECÇÃO DE INTENÇÃO ─────────────────────────────────────

function isIdeaMessage(text) {
  if (text.length < 80) return false;
  const lower = normalizeText(text);
  return [
    'pensei em', 'tive uma ideia', 'ideia de', 'quero fazer', 'quero criar',
    'podia fazer', 'poderia fazer', 'que tal fazer', 'vamos fazer', 'vou criar',
    'preciso criar', 'quero lançar', 'vou lançar', 'quero desenvolver',
    'e se a gente', 'pensei em criar', 'to pensando em',
  ].some(t => lower.includes(normalizeText(t)));
}

function isDecisaoRequest(text) {
  const lower = normalizeText(text);
  return [
    'o que voce acha', 'o que acha de', 'como devo', 'o que devo fazer',
    'qual e melhor', 'qual seria melhor', 'como faco', 'o que fazer com',
    'me ajuda a decidir', 'nao sei se', 'estou em duvida', 'fico na duvida',
    'vale a pena', 'devo ou nao', 'faco ou nao',
  ].some(t => lower.includes(t));
}

function isBriefingRequest(text) {
  const lower = text.toLowerCase();
  return [
    'briefing',
    'resumo da manha',
    'resumo da manhã',
    'check do dia',
    'meu dia',
    'minha manha',
    'minha manhã',
    'prioridade de hoje',
    'prioridades de hoje',
  ].some(trigger => lower.includes(trigger));
}

async function buildManualBriefingPrompt() {
  const { start, end, label } = getBrtTodayRange();
  const agenda = await listarEventos(start, end);
  const emails = await listarEmailsManha({ limit: 12, hours: 18 });

  return [
    `Data de hoje: ${label}.`,
    '',
    'AGENDA ATUAL — fonte Google Calendar:',
    agenda,
    '',
    'E-MAILS ZOHO — fonte Zoho Mail API:',
    emails,
    '',
    'Monte o briefing da Talita agora.',
    'Regras:',
    '- Nao use emoji.',
    '- Nao coloque titulo com "Mariah" ou "Briefing Mariah".',
    '- Nao diga que o dia esta livre se houver evento na agenda.',
    '- Nao diga que nao tem acesso ao Zoho se os e-mails acima aparecerem.',
    '- Nao devolva coleta para Talita. Se algo falhar, acione Nara em uma linha.',
    '- Se precisar citar Nara, diga exatamente o que Nara vai verificar.',
    '',
    'Formato:',
    'Leitura: 1 frase.',
    'Agenda: compromissos principais em linhas curtas.',
    'Inbox: somente o que pede atencao.',
    'Prioridade: 1 foco para hoje.',
    'Eu ja vou: o que voce ou Nara resolvem sem Talita.',
  ].join('\n');
}

function isZoomRequest(text) {
  const lower = normalizeText(text);
  const criacaoVerbs = ['criar', 'cria', 'crie', 'gera', 'gerar', 'abre', 'abrir', 'faz', 'fazer', 'manda', 'mandar', 'preciso de um', 'preciso de link', 'me manda', 'me faz', 'me cria'];
  const zoomWords = ['zoom', 'link de reuniao', 'link da reuniao', 'link para reuniao', 'link reuniao', 'reuniao online', 'meeting link'];
  const temCriacao = criacaoVerbs.some(v => lower.includes(v));
  const temZoom = zoomWords.some(w => lower.includes(w));
  if (temCriacao && temZoom) return true;
  if (lower.includes('link') && (lower.includes('reuniao') || lower.includes('meeting')) && temCriacao) return true;
  return false;
}

// ─── NOTION ───────────────────────────────────────────────────
const { isConfigured: isNotionConfigured, searchNotion, readPage, queryDatabase, createPage } = require('../services/notion');

async function processNotionRequest(userText, _systemPrompt) {
  if (!isNotionConfigured()) return null;

  const lower = userText.toLowerCase();
  const isNotionRequest =
    lower.includes('notion') ||
    lower.includes('minha base') ||
    lower.includes('meu banco') ||
    lower.includes('minha página') ||
    lower.includes('minha pagina') ||
    lower.includes('meu documento') ||
    lower.includes('no notion') ||
    lower.includes('do notion');

  if (!isNotionRequest) return null;

  try {
    // Detecta ID de página/database na mensagem (UUID do Notion)
    const idMatch = userText.match(/([a-f0-9]{32}|[a-f0-9-]{36})/i);

    // Ação: criar página
    if (lower.includes('cria') || lower.includes('adiciona') || lower.includes('registra')) {
      const { callClaudeFast: fast } = require('../claude');
      const raw = await fast(
        'Extraia do texto: {"parent_id": "id do banco/página pai ou null", "title": "título", "content": "conteúdo"}. JSON sem markdown.',
        userText, 200
      );
      const parsed = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      if (parsed.parent_id && parsed.title) {
        const result = await createPage(parsed.parent_id, parsed.title, parsed.content || '');
        return result;
      }
    }

    // Ação: ler página específica
    if (idMatch && (lower.includes('lê') || lower.includes('le ') || lower.includes('abre') || lower.includes('mostra') || lower.includes('qual') || lower.includes('o que tem'))) {
      const content = await readPage(idMatch[1]);
      return content;
    }

    // Ação: busca
    const queryMatch = userText.match(/(?:busca|procura|encontra|pesquisa|acha)\s+(?:no notion\s+)?(.+?)(?:\s+no notion)?$/i);
    const query = queryMatch ? queryMatch[1] : userText.replace(/notion/gi, '').trim();
    const results = await searchNotion(query);
    return `Resultados no Notion para "${query}":\n\n${results}`;

  } catch (err) {
    return `Erro ao acessar o Notion: ${err.message}`;
  }
}

// ─── FETCH URL ────────────────────────────────────────────────
async function fetchUrl(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Mariah/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    const contentType = res.headers.get('content-type') || '';

    // Google Drive — converte para download direto
    if (url.includes('drive.google.com/file/d/')) {
      const match = url.match(/\/d\/([^/]+)/);
      if (match) {
        const exportUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
        const exportRes = await fetch(exportUrl, { signal: AbortSignal.timeout(10000) });
        const text = await exportRes.text();
        return text.slice(0, 6000);
      }
    }

    if (contentType.includes('text') || contentType.includes('json') || contentType.includes('html')) {
      const html = await res.text();
      // Remove tags HTML para texto limpo
      const clean = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 6000);
      return clean;
    }
    return `Arquivo do tipo ${contentType} — não consigo ler o conteúdo diretamente.`;
  } catch (err) {
    return `Erro ao acessar o link: ${err.message}`;
  }
}

// Detecta URLs numa mensagem
function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s]+/g;
  return text.match(urlRegex) || [];
}

// ─── ANÁLISE DE IMAGEM ────────────────────────────────────────
async function analyzePhoto(fileId, caption, systemPrompt) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  try {
    // Baixa o arquivo do Telegram
    const fileRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    if (!fileData.result?.file_path) throw new Error('getFile falhou');

    const imgRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${fileData.result.file_path}`);
    if (!imgRes.ok) throw new Error('download imagem falhou');
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const base64 = imgBuffer.toString('base64');
    const mimeType = fileData.result.file_path.endsWith('.png') ? 'image/png' : 'image/jpeg';

    // Chama Claude com visão
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: caption || 'Analise esta imagem e responda como Mariah.' },
        ],
      }],
    });
    return response.content[0].text;
  } catch (err) {
    return `Não consegui analisar a imagem: ${err.message}`;
  }
}

// ─── BUSCA NA WEB ─────────────────────────────────────────────
async function webSearch(query) {
  try {
    // Brave Search API
    const braveKey = process.env.BRAVE_SEARCH_API_KEY;
    if (braveKey) {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&country=br&lang=pt`, {
        headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey },
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      const results = (data.web?.results || []).slice(0, 5);
      if (results.length) {
        return results.map(r => `• ${r.title}\n  ${r.description || ''}\n  ${r.url}`).join('\n\n');
      }
    }

    // Fallback: DuckDuckGo Instant Answer
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    const resumo = data.AbstractText || data.Answer || '';
    const related = (data.RelatedTopics || []).slice(0, 4).map(t => `• ${t.Text || ''}`).join('\n');
    return [resumo, related].filter(Boolean).join('\n\n') || 'Sem resultados diretos — tente refinar a busca.';
  } catch (err) {
    return `Erro na busca: ${err.message}`;
  }
}

async function processMariahText(userText, source, chatId = null, channelMode = 'geral') {
  const lowerText = userText.toLowerCase();
  const emailTriggers = ['email', 'e-mail', 'caixa', 'inbox', 'mensagens do email', 'correio', 'zoho', 'listar email', 'ver email', 'meus emails'];
  const pedindoEmail = emailTriggers.some(t => lowerText.includes(t));

  if (isBriefingRequest(userText)) {
    try {
      const system = await buildMariahSystem(channelMode);
      const prompt = await buildManualBriefingPrompt();
      const raw = await callClaude(system, prompt, 1500);
      pushToHistory(chatId, 'user', userText);
      pushToHistory(chatId, 'assistant', raw);
      return formatForTelegram(raw);
    } catch (err) {
      return formatForTelegram('A consulta de agenda ou e-mail falhou. Vou acionar Nara para diagnosticar conexão de Google Calendar e Zoho.');
    }
  }

  if (pedindoEmail && isEmailConfigured()) {
    try {
      const emails = await listarEmailsManha({ limit: 12, hours: 24 });
      const system = await buildMariahSystem(channelMode);
      const prompt = `Aqui estão os e-mails recentes da Talita:\n\n${emails}\n\nResuma de forma clara e humana, como uma assistente executiva faria. Destaque o que precisa de atenção urgente, o que é financeiro importante e o que pode ignorar. Seja direta, sem emoji e sem título com seu nome.`;
      const raw = await callClaude(system, prompt, 1200);
      pushToHistory(chatId, 'user', userText);
      pushToHistory(chatId, 'assistant', raw);
      return formatForTelegram(raw);
    } catch (err) {
      return formatForTelegram('Erro ao buscar e-mails. Tente novamente.');
    }
  }

  if (isZoomRequest(userText) && isZoomConfigured()) {
    const lowerZoom = userText.toLowerCase();
    const isIndividual = lowerZoom.includes('individual') || lowerZoom.includes('1:1') || lowerZoom.includes('one on one');
    const emailMatch = userText.match(/[\w.+\-]+@[\w.\-]+\.\w+/);

    if (isIndividual && !emailMatch) {
      const msg = 'Qual é o e-mail da participante? Assim eu já envio o link direto para ela.';
      pushToHistory(chatId, 'user', userText);
      pushToHistory(chatId, 'assistant', msg);
      return formatForTelegram(msg);
    }

    try {
      const meeting = await criarReuniaoZoom({ topic: 'Reunião' });
      let reply = `Zoom criado.\n\n${meeting.joinUrl}\nSenha: ${meeting.password || 'sem senha'}\nID: ${meeting.meetingId}`;

      if (emailMatch && isEmailConfigured()) {
        try {
          await enviarEmail({
            to: emailMatch[0],
            subject: 'Link da sua reunião com Talita',
            body: `Olá!\n\nSegue o link para a sua reunião:\n\n${meeting.joinUrl}\nSenha: ${meeting.password || 'sem senha'}\n\nAté logo!`,
          });
          reply += `\n\nLink enviado para ${emailMatch[0]}`;
        } catch (err) {
          reply += `\n\nE-mail não enviado: ${err.message}`;
        }
      } else if (emailMatch) {
        reply += '\n\nConfigure ZOHO_OAUTH* no Render para envio de e-mail.';
      }

      pushToHistory(chatId, 'user', userText);
      pushToHistory(chatId, 'assistant', reply);
      return formatForTelegram(reply);
    } catch (err) {
      return formatForTelegram(`Erro ao criar reunião Zoom: ${err.message}`);
    }
  }

  const system = await buildMariahSystem(channelMode);
  const calendarResponse = await processMariahCalendar(userText, system);
  if (calendarResponse) {
    registrarNaMemoria(userText, calendarResponse).catch(() => {});
    pushToHistory(chatId, 'user', userText);
    pushToHistory(chatId, 'assistant', calendarResponse);
    return formatForTelegram(calendarResponse);
  }

  // Ideia solta → plano estruturado
  if (isIdeaMessage(userText)) {
    const prompt = `A Talita mandou uma ideia ou projeto. Não responda como conversa — entregue um plano estruturado.

Mensagem da Talita: "${userText}"

Formato obrigatório:
O que é: [1 frase]
Por que faz sentido agora: [1 frase com oportunidade ou urgência]
Como executar:
• [ação] — [dono do squad] — [prazo em dias/data]
• ...
Decisão sua: [só o que depende de Talita — se não houver, omita]
Eu já aciono: [quem do squad faz o quê — acione de verdade via delegação]

Máximo 200 palavras. Sem emoji. Sem introdução.`;
    const raw = await callClaude(system, prompt, 1000);
    const response = formatForTelegram(raw);
    registrarNaMemoria(userText, raw).catch(() => {});
    pushToHistory(chatId, 'user', userText);
    pushToHistory(chatId, 'assistant', raw);
    return response;
  }

  // Decisão pendente → 3 cenários
  if (isDecisaoRequest(userText)) {
    const prompt = `A Talita está diante de uma decisão. Não dê só uma resposta — apresente 3 cenários.

Mensagem da Talita: "${userText}"

Formato obrigatório:
*Cenário A — [nome curto da opção conservadora]*
Resultado: [o que acontece]
Risco: [o que pode dar errado]

*Cenário B — [nome curto da opção intermediária]*
Resultado: [o que acontece]
Risco: [o que pode dar errado]

*Cenário C — [nome curto da opção mais rápida/agressiva]*
Resultado: [o que acontece]
Risco: [o que pode dar errado]

Minha recomendação: [qual e por quê em 1 frase direta]

Sem emoji. Sem introdução. Direto ao ponto.`;
    const raw = await callClaude(system, prompt, 1000);
    const response = formatForTelegram(raw);
    registrarNaMemoria(userText, raw).catch(() => {});
    pushToHistory(chatId, 'user', userText);
    pushToHistory(chatId, 'assistant', raw);
    return response;
  }

  // Conversa padrão — com histórico completo da sessão
  const history = getHistory(chatId);
  const messages = [...history, { role: 'user', content: userText }];
  const raw = await callClaudeWithHistory(system, messages, 1500);
  const response = formatForTelegram(raw);
  registrarNaMemoria(userText, raw).catch(() => {});
  pushToHistory(chatId, 'user', userText);
  pushToHistory(chatId, 'assistant', raw);
  return response;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function extractTelegramMessage(update) {
  if (!update) return null;
  const message = update.message || update.edited_message;
  if (!message) return null;
  const text = message.text || message.caption || '';
  const voice = message.voice;
  const photo = message.photo;
  // Pega a maior resolução disponível
  const photoFileId = photo ? photo[photo.length - 1]?.file_id : null;
  return {
    chatId: message.chat && message.chat.id,
    userId: message.from && message.from.id,
    firstName: message.from && message.from.first_name,
    text: text.trim(),
    hasVoice: !!voice,
    hasPhoto: !!photo,
    voiceFileId: (voice && voice.file_id) || null,
    photoFileId,
  };
}

// Registro temporário de chats desconhecidos — para descobrir IDs de novos grupos
const _unknownChats = new Map(); // chatId → { title, date }

function isAllowedChat(chatId) {
  const id = String(chatId);
  // Sem configuração = aceita todos os chats (modo desenvolvimento)
  if (_channelConfig.size === 0) return true;
  // Sempre permite o chat principal independente de TELEGRAM_CHANNELS
  const principal = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (principal && id === String(principal)) return true;
  return _channelConfig.has(id);
}

function registerUnknownChat(chatId, title) {
  if (!_channelConfig.has(String(chatId))) {
    _unknownChats.set(String(chatId), { title: title || 'sem título', date: new Date().toISOString() });
  }
}

async function transcribeVoice(fileId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const googleKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_API_KEY;
  if (!googleKey) throw new Error('GOOGLE_CLOUD_API_KEY ausente');

  const fileRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  if (!fileRes.ok || !fileData.result?.file_path) {
    throw new Error(`getFile falhou: ${fileRes.status}`);
  }
  const filePath = fileData.result.file_path;
  const audioRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  if (!audioRes.ok) {
    throw new Error(`download audio falhou: ${audioRes.status}`);
  }
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  const audioBase64 = audioBuffer.toString('base64');

  const speechBody = {
    config: {
      encoding: 'OGG_OPUS',
      sampleRateHertz: 48000,
      languageCode: 'pt-BR',
      model: 'latest_long',
    },
    audio: { content: audioBase64 },
  };
  const speechRes = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${googleKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(speechBody) }
  );
  const speechData = await speechRes.json();
  if (!speechRes.ok) {
    const detail = speechData?.error?.message || `Speech status: ${speechRes.status}`;
    throw new Error(detail.slice(0, 180));
  }
  const transcript = (speechData.results || [])
    .map(r => r.alternatives?.[0]?.transcript || '')
    .join(' ')
    .trim();
  return transcript;
}

async function handleTelegramUpdate(update, logger) {
  if (!logger) logger = console;
  const msg = extractTelegramMessage(update);
  if (!msg || !msg.chatId) return;

  // Registra chat desconhecido para diagnóstico (descobrir IDs de novos grupos)
  const chatTitle = update.message?.chat?.title || update.message?.chat?.username || null;
  registerUnknownChat(msg.chatId, chatTitle);

  if (!isAllowedChat(msg.chatId)) {
    logger.warn('Telegram bloqueado para chat_id=' + msg.chatId);
    await sendTelegramMessage(msg.chatId, 'Este bot da Mariah ainda nao esta liberado para este chat.');
    return;
  }
  if (msg.text === '/start') {
    await sendTelegramMessage(msg.chatId, 'Sou a Mariah. Me manda texto, ideia solta, print com legenda ou comando rapido.');
    return;
  }

  // Determina o modo do canal
  const channelMode = getChannelMode(msg.chatId) || 'geral';

  // Carrega histórico do Supabase na primeira mensagem da sessão (após restart)
  await ensureHistoryLoaded(msg.chatId);

  let userText = msg.text;
  let sourceIsVoice = false;

  // ── Voz ──
  if (!userText && msg.hasVoice) {
    try {
      userText = await transcribeVoice(msg.voiceFileId);
      if (!userText) throw new Error('vazio');
      sourceIsVoice = true;
    } catch (err) {
      logger.error('Erro ao transcrever audio:', err.message);
      await sendTelegramMessage(msg.chatId, 'Não consegui transcrever. Pode mandar em texto?');
      return;
    }
  }

  // ── Imagem: analisa com Claude vision ──
  if (msg.hasPhoto && msg.photoFileId) {
    try {
      const system = await buildMariahSystem(channelMode);
      const caption = msg.text || 'Analise esta imagem e responda como Mariah.';
      const response = await analyzePhoto(msg.photoFileId, caption, system);
      await sendTelegramMessage(msg.chatId, response);
      registrarNaMemoria(caption, response).catch(() => {});
    } catch (err) {
      logger.error('Erro ao analisar imagem:', err.message);
      await sendTelegramMessage(msg.chatId, 'Não consegui analisar a imagem.');
    }
    return;
  }

  if (!userText) return;

  // ── URL: só busca conteúdo se há link E não é link do Telegram/API ──
  const urls = extractUrls(userText).filter(u =>
    !u.includes('t.me') && !u.includes('telegram') && !u.includes('api.telegram')
  );
  if (urls.length > 0) {
    try {
      const conteudos = await Promise.all(urls.map(async url => {
        const conteudo = await fetchUrl(url);
        return `[Conteúdo de ${url}]:\n${conteudo}`;
      }));
      userText = userText + '\n\n' + conteudos.join('\n\n');
    } catch (err) {
      logger.warn('Erro ao buscar URL:', err.message);
    }
  }

  // ── Busca web: só dispara com comando explícito ──
  const buscaExplicita = /^(busca|pesquisa|pesquise|procure|encontre|quanto custa|qual o preço|voos? (para|de)|hoteis? em)\s+/i;
  if (buscaExplicita.test(userText.trim()) && !urls.length) {
    try {
      const query = userText.replace(buscaExplicita, '').trim();
      const resultados = await webSearch(query);
      userText = userText + '\n\n[Resultados da busca]:\n' + resultados;
    } catch (err) {
      logger.warn('Erro na busca web:', err.message);
    }
  }

  // ── Notion: detecta intenção e executa (sem chamar buildMariahSystem de novo) ──
  const notionResponse = await processNotionRequest(userText, null);
  if (notionResponse) {
    await sendTelegramMessage(msg.chatId, notionResponse);
    registrarNaMemoria(userText, notionResponse).catch(() => {});
    return;
  }

  // Gatilho: novo cliente / fechamento
  if (isNovoClienteGatilho(userText)) {
    acionarOnboarding(userText, msg.chatId, logger).catch(() => {});
  }

  const response = await processMariahText(userText, sourceIsVoice ? 'Audio' : 'Telegram', msg.chatId, channelMode);

  // Coordena squad em paralelo — não bloqueia a resposta para Talita
  detectarEDelegarSquad(userText, response, logger).catch(() => {});

  const useVoice = shouldRespondWithVoice(userText, sourceIsVoice);
  if (useVoice) {
    try {
      const { buffer, mime } = await textToSpeech(response);
      await sendTelegramVoice(msg.chatId, buffer, mime);
    } catch (err) {
      logger.error('Erro ao gerar voz:', err.message);
      await sendTelegramMessage(msg.chatId, response);
    }
  } else {
    await sendTelegramMessage(msg.chatId, response);
  }
}

function registerTelegramMariah(receiver, logger, slackClient) {
  if (!logger) logger = console;
  if (slackClient) _slackClient = slackClient;

  receiver.router.get('/telegram/status', function(req, res) {
    const channels = [];
    _channelConfig.forEach((mode, id) => channels.push({ id, mode, label: CHANNEL_MODES[mode]?.label || mode }));
    const unknown = [];
    _unknownChats.forEach((info, id) => unknown.push({ id, title: info.title, date: info.date }));
    res.json({
      ok: true,
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      webhook: '/telegram/webhook',
      channels,
      channels_configured: channels.length,
      unknown_chats: unknown,
    });
  });

  receiver.router.post('/telegram/webhook', async function(req, res) {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (expectedSecret && receivedSecret !== expectedSecret) {
      return res.status(401).json({ ok: false, error: 'telegram_secret_invalid' });
    }
    res.status(200).json({ ok: true });
    try {
      const update = await readJsonBody(req);
      await handleTelegramUpdate(update, logger);
    } catch (err) {
      logger.error('Erro no Telegram Mariah:', err.message);
    }
  });

  receiver.router.post('/mariah/shortcut', async function(req, res) {
    const expectedSecret = process.env.MARIAH_SHORTCUT_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;
    const receivedSecret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.secret;
    if (!expectedSecret) {
      return res.status(500).json({ ok: false, error: 'MARIAH_SHORTCUT_SECRET ausente' });
    }
    if (receivedSecret !== expectedSecret) {
      return res.status(401).json({ ok: false, error: 'shortcut_secret_invalid' });
    }
    try {
      const body = await readJsonBody(req);
      const text = String(req.query.text || body.text || body.message || '').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'text_required' });

      const chatId = req.query.chat_id || body.chat_id || process.env.TELEGRAM_ALLOWED_CHAT_ID;

      // Responde imediatamente para não dar timeout no iOS Shortcuts
      res.json({ ok: true, response: 'Processando...' });

      // Processa e envia pelo Telegram em background
      processMariahText(text, 'Atalho iPhone')
        .then(response => {
          if (chatId) return sendTelegramMessage(chatId, response);
        })
        .catch(err => logger.error('Erro no Atalho da Mariah:', err.message));

    } catch (err) {
      logger.error('Erro no Atalho da Mariah:', err.message);
      if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── /mariah/checkin — geolocalização iPhone ──────────────────
  // Chamado pelo Atalho quando Talita chega ou sai de um local
  receiver.router.post('/mariah/checkin', async function(req, res) {
    const expectedSecret = process.env.MARIAH_SHORTCUT_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;
    const receivedSecret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.secret;
    if (expectedSecret && receivedSecret !== expectedSecret) {
      return res.status(401).json({ ok: false, error: 'secret_invalid' });
    }

    try {
      const body = await readJsonBody(req);
      const tipo = String(body.tipo || 'chegada').toLowerCase(); // 'chegada' ou 'saida'
      const local = String(body.local || 'academia').toLowerCase();
      const chatId = body.chat_id || process.env.TELEGRAM_ALLOWED_CHAT_ID;

      const brtNow = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
      }).format(new Date());

      let mensagem = '';
      let registroMemoria = '';

      if (tipo === 'chegada') {
        const msgMap = {
          pilates:  `${brtNow} — Chegou no pilates. Vai bem.`,
          academia: `${brtNow} — Chegou na academia. Treino iniciado.`,
          studio:   `${brtNow} — Chegou no estúdio. Gravação iniciada?`,
        };
        mensagem = msgMap[local] || `${brtNow} — Check-in: ${local}.`;
        registroMemoria = `Chegou em: ${local} às ${brtNow}`;
      } else {
        const msgMap = {
          pilates:  `Como foi o pilates? Responde aqui — registra na memória.`,
          academia: `Treino concluído. Como foi? Registra aqui.`,
          studio:   `Saiu do estúdio. Gravação foi?`,
        };
        mensagem = msgMap[local] || `Saiu de: ${local} às ${brtNow}.`;
        registroMemoria = `Saiu de: ${local} às ${brtNow}`;
      }

      // Registra na memória da Mariah
      const { writeMariahMemory, readMariahMemory } = require('../memory/index');
      const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const atual = await readMariahMemory('preferencias') || '';
      await writeMariahMemory('preferencias', atual + `\n[${hoje}] ${registroMemoria}`);

      // Manda mensagem no Telegram
      if (chatId) await sendTelegramMessage(chatId, mensagem);

      res.json({ ok: true, mensagem });
    } catch (err) {
      logger.error('Erro no check-in:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  logger.info('Telegram Mariah registrado: /telegram/webhook | /telegram/status | /mariah/shortcut | /mariah/checkin');
}

module.exports = { registerTelegramMariah, handleTelegramUpdate, setTelegramWebhook, sendTelegramMessage, getMilestoneContext };
