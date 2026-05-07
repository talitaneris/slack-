'use strict';

const { AGENTS } = require('../agents');
const { callClaude } = require('../claude');
const { processMariahCalendar } = require('../handlers/mariah');
const { readMemory, appendMemory } = require('../memory/index');
const { getPrivateContextForAgent } = require('../privateContext');

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
    logger.warn('Telegram webhook não configurado: TELEGRAM_BOT_TOKEN ausente.');
    return;
  }

  const baseUrl = (publicBaseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    logger.warn('Telegram webhook não configurado: URL pública ausente.');
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

async function processMariahText(userText, source = 'Texto') {
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
    'Formato preferido: Entendi / Vou organizar assim / Depende de voce apenas se houver decisao real.',
    '',
    agent.system,
  ].join('\n');

  try {
    const privateContext = await getPrivateContextForAgent(agent.key);
    if (privateContext && privateContext.trim()) {
      system = `${system}\n\n${privateContext}`;
    }
  } catch {
    // Telegram continua mesmo sem contexto privado
  }

  try {
    const memory = await readMemory(agent.key);
    if (memory && memory.trim()) {
      system = `${system}\n\nMEMORIA RECENTE DA MARIAH:\n${memory.slice(-3500)}`;
    }
  } catch {
    // Memoria nao bloqueia
  }

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
  } catch {
    return {};
  }
}

function extractTelegramMessage(update = {}) {
  const message = update.message || update.edited_message;
  if (!message) return null;

  const text = message.text || message.caption || '';
  const voice = message.voice;
  const photo = message.photo;

  return {
    chatId: message.chat?.id,
    userId: message.from?.id,
    firstName: message.from?.first_name,
    text: text.trim(),
    hasVoice: !!voice,
    hasPhoto: !!photo,
    voiceFileId: voice?.file_id || null,
  };
}

function isAllowedChat(chatId) {
  const allowed = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!allowed) return true;
  return String(chatId) === String(allowed);
}

async function transcribeVoice(fileId, logger = console) {
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
          { text: 'Transcreva este áudio em português.' }
        ]
      }
    ]
  };

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${googleKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const geminiData = await geminiRes.json();

  if (!geminiRes.ok) {
    throw new Error(`got status: ${geminiRes.status} . ${JSON.stringify(geminiData)}`);
  }

  return geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function handleTelegramUpdate(update, logger = console) {
  const msg = extractTelegramMessage(update);
  if (!msg || !msg.chatId) return;

  if (!isAllowedChat(msg.chatId)) {
    logger.warn(`Telegram bloqueado para chat_id=${msg.chatId}`);
    await sendTelegramMessage(msg.chatId, 'Este bot da Mariah ainda nao esta liberado para este chat.');
    return;
  }

  if (msg.text === '/start') {
    await sendTelegramMessage(
      msg.chatId,
      'Sou a Mariah. Me manda texto, ideia solta, print com legenda ou comando rapido. Eu organizo, registro e aciono o agente certo quando precisar.'
    );
    return;
  }

  let userText = msg.text;

  if (!userText && msg.hasVoice) {
    try {
      userText = await transcribeVoice(msg.voiceFileId, logger);
      if (!userText) throw new Error('Transcrição vazia');
    } catch (err) {
      logger.error('Erro ao transcrever áudio:', err.message);
      userText = 'Talita enviou um áudio mas não consegui transcrever. Me conta o que era?';
    }
  }

  if (!userText && msg.hasPhoto) {
    userText = 'Talita enviou uma imagem ou print no Telegram sem legenda. Responda como Mariah: diga que recebeu, peça uma frase de contexto se necessario e explique que prints importantes viram tarefa, memoria ou acionamento de Nara/agente dono.';
  }

  if (!userText) return;

  const response = await processMariahText(userText, 'Telegram');

  await sendTelegramMessage(msg.chatId, response);
}

function registerTelegramMariah(receiver, logger = console) {
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
    const receivedSecret = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.secret;

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

