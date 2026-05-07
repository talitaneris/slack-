'use strict';

const { AGENTS } = require('../agents');
const { callClaude } = require('../claude');
const { processMariahCalendar } = require('../handlers/mariah');
const { readMemory, appendMemory } = require('../memory/index');
const { getPrivateContextForAgent } = require('../privateContext');
const { listarEmailsManha, isEmailConfigured } = require('./services/email');

const TELEGRAM_API = 'https://api.telegram.org';

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

function formatForTelegram(text = '') {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '*$1*')
    .replace(/^\s*-{3,}\s*$/gm, '')
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

async function setTelegramWebhook(publicBaseUrl, logger = console) {
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

async function sendTelegramVoice(chatId, audioBuffer) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  formData.append('voice', new Blob([audioBuffer], { type: 'audio/ogg; codecs=opus' }), 'voice.ogg');

  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendVoice`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`sendVoice falhou: ${response.status} ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function textToSpeech(text) {
  const googleKey = process.env.GOOGLE_API_KEY;
  const body = {
    input: { text: text.slice(0, 4000) },
    voice: {
      languageCode: 'pt-BR',
      name: 'pt-BR-Wavenet-A',
      ssmlGender: 'FEMALE',
    },
    audioConfig: {
      audioEncoding: 'OGG_OPUS',
    },
  };

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`TTS falhou: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return Buffer.from(data.audioContent, 'base64');
}

async function shouldRespondWithVoice(userText, responseText, sourceIsVoice) {
  if (sourceIsVoice) return true;

  const lowerUser = userText.toLowerCase();
  const voiceTriggers = [
    'como voce esta', 'to bem', 'cansada', 'animada',
    'preocupada', 'feliz', 'triste', 'preciso conversar',
    'me ajuda', 'o que voce acha', 'sua opiniao'
  ];
  const textTriggers = [
    'lista', 'checklist', 'tarefas', 'pendencias', 'agenda',
    'reuniao', 'horario', 'relatorio', 'dados', 'numeros'
  ];

  const hasTextTrigger = textTriggers.some(t => lowerUser.includes(t));
  if (hasTextTrigger) return false;

  const hasVoiceTrigger = voiceTriggers.some(t => lowerUser.includes(t));
  if (hasVoiceTrigger) return true;

  return false;
}

async function processMariahText(userText, source) {
  const lowerText = userText.toLowerCase();
  const emailTriggers = ['email', 'e-mail', 'caixa', 'inbox', 'mensagem', 'mensagens', 'correio', 'zoho'];
  const pedindoEmail = emailTriggers.some(t => lowerText.includes(t));

  if (pedindoEmail && isEmailConfigured()) {
    const emails = await listarEmailsManha({ limit: 12, hours: 24 });
    return formatForTelegram(`📬 E-mails recentes:\n\n${emails}`);
  }

  const system = await buildMariahSystem();
  const calendarResponse = await processMariahCalendar(userText, system);
  const response = formatForTelegram(calendarResponse || await callClaude(system, userText, 600));

  appendMemory(
    AGENTS.assistente.key,
    [
      `Fonte: ${source}`,
      `Data: ${getBrtNow()}`,
      `Mensagem da Talita: ${userText.slice(0, 600)}`,
      `Resposta da Mariah: ${response.slice(0, 600)}`,
    ].join('\n')
  ).catch(() => {});

  return response;
}

async function buildMariahSystem() {
  const agent = AGENTS.assistente;
  let system = [
    `Agora em America/Sao_Paulo: ${getBrtNow()}.`,
    'CANAL: Telegram. Responda como Mariah, agente executiva da Talita.',
    'Telegram e porta de entrada rapida: mensagem curta, audio, ideia solta, comando pessoal, rotina e organizacao.',
    'Se faltar dado/base/acesso, acione Nara ou diga qual acesso falta. Nao devolva bagunca para Talita.',
    'Formato preferido: Entendi / Vou organizar assim / Depende de voce apenas se houver uma decisao sua.',
    'Quando precisar de mais contexto para agir, pergunte de forma direta e natural.',
    '',
    agent.system,
  ].join('\n');

  try {
    const privateContext = await getPrivateContextForAgent(agent.key);
    if (privateContext && privateContext.trim()) {
      system = `${system}\n\n${privateContext}`;
    }
  } catch (e) {}

  try {
    const memory = await readMemory(agent.key);
    if (memory && memory.trim()) {
      system = `${system}\n\nMEMORIA RECENTE DA MARIAH:\n${memory.slice(-3500)}`;
    }
  } catch (e) {}

  return system;
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

  return {
    chatId: message.chat && message.chat.id,
    userId: message.from && message.from.id,
    firstName: message.from && message.from.first_name,
    text: text.trim(),
    hasVoice: !!voice,
    hasPhoto: !!photo,
    voiceFileId: voice && voice.file_id || null,
  };
}

function isAllowedChat(chatId) {
  const allowed = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!allowed) return true;
  return String(chatId) === String(allowed);
}

async function transcribeVoice(fileId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const googleKey = process.env.GOOGLE_API_KEY;

  const fileRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  const filePath = fileData.result.file_path;

  const audioRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  const audioBase64 = audioBuffer.toString('base64');

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'audio/ogg', data: audioBase64 } },
          { text: 'Transcreva este audio em portugues.' }
        ]
      }
    ]
  };

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const geminiData = await geminiRes.json();

  if (!geminiRes.ok) {
    throw new Error(`Gemini status: ${geminiRes.status}`);
  }

  return geminiData.candidates[0].content.parts[0].text || '';
}

async function handleTelegramUpdate(update, logger) {
  if (!logger) logger = console;

  const msg = extractTelegramMessage(update);
  if (!msg || !msg.chatId) return;

  if (!isAllowedChat(msg.chatId)) {
    logger.warn(`Telegram bloqueado para chat_id=${msg.chatId}`);
    await sendTelegramMessage(msg.chatId, 'Este bot da Mariah ainda nao esta liberado para este chat.');
    return;
  }

  if (msg.text === '/start') {
    await sendTelegramMessage(msg.chatId, 'Sou a Mariah. Me manda texto, ideia solta, print com legenda ou comando rapido.');
    return;
  }

  let userText = msg.text;
  let sourceIsVoice = false;

  if (!userText && msg.hasVoice) {
    try {
      userText = await transcribeVoice(msg.voiceFileId);
      if (!userText) throw new Error('vazio');
      sourceIsVoice = true;
    } catch (err) {
      logger.error('Erro ao transcrever audio:', err.message);
      userText = 'Talita enviou um audio mas nao consegui transcrever. Me conta o que era?';
    }
  }

  if (!userText && msg.hasPhoto) {
    userText = 'Talita enviou uma imagem no Telegram sem legenda. Responda como Mariah.';
  }

  if (!userText) return;

  const response = await processMariahText(userText, sourceIsVoice ? 'Audio' : 'Telegram');

  const useVoice = await shouldRespondWithVoice(userText, response, sourceIsVoice);

  if (useVoice) {
    try {
      const audioBuffer = await textToSpeech(response);
      await sendTelegramVoice(msg.chatId, audioBuffer);
    } catch (err) {
      logger.error('Erro ao gerar voz:', err.message);
      await sendTelegramMessage(msg.chatId, response);
    }
  } else {
    await sendTelegramMessage(msg.chatId, response);
  }
}

function registerTelegramMariah(receiver, logger) {
  if (!logger) logger = console;

  receiver.router.get('/telegram/status', (req, res) => {
    res.json({
      ok: true,
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      webhook: '/telegram/webhook',
      allowed_chat_configured: !!process.env.TELEGRAM_ALLOWED_CHAT_ID,
    });
  });

  receiver.router.post('/telegram/webhook', async (req, res) => {
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

  receiver.router.post('/mariah/shortcut', async (req, res) => {
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
      const text = String(body.text || body.message || '').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'text_required' });

      const response = await processMariahText(text, 'Atalho iPhone');
      const chatId = body.chat_id || process.env.TELEGRAM_ALLOWED_CHAT_ID;

      if (body.send_to_telegram && chatId) {
        await sendTelegramMessage(chatId, response);
      }

      res.json({ ok: true, response });
    } catch (err) {
      logger.error('Erro no Atalho da Mariah:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  logger.info('Telegram Mariah registrado: /telegram/webhook | /telegram/status | /mariah/shortcut');
}

module.exports = { registerTelegramMariah, handleTelegramUpdate, setTelegramWebhook };
