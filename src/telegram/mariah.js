'use strict';

const { AGENTS } = require('../agents');
const { callClaude } = require('../claude');
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

async function sendTelegramMessage(chatId, text) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text: formatForTelegram(text),
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
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

function extractTelegramMessage(update) {
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
  };
}

function isAllowedChat(chatId) {
  const allowed = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!allowed) return true;
  return String(chatId) === String(allowed);
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
    userText = 'Talita enviou um audio no Telegram. A transcricao automatica ainda nao esta conectada. Responda como Mariah: diga que recebeu, peça uma frase-guia se necessario e explique como vai organizar assim que a transcricao estiver ativa.';
  }

  if (!userText && msg.hasPhoto) {
    userText = 'Talita enviou uma imagem ou print no Telegram sem legenda. Responda como Mariah: diga que recebeu, peça uma frase de contexto se necessario e explique que prints importantes viram tarefa, memoria ou acionamento de Nara/agente dono.';
  }

  if (!userText) return;

  const system = await buildMariahSystem();
  const response = formatForTelegram(await callClaude(system, userText, 600));

  await sendTelegramMessage(msg.chatId, response);

  appendMemory(
    AGENTS.assistente.key,
    [
      'Fonte: Telegram',
      `Data: ${getBrtNow()}`,
      `Mensagem da Talita: ${userText.slice(0, 600)}`,
      `Resposta da Mariah: ${response.slice(0, 600)}`,
    ].join('\n')
  ).catch(() => {});
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
      await handleTelegramUpdate(req.body, logger);
    } catch (err) {
      logger.error('Erro no Telegram Mariah:', err.message);
    }
  });

  logger.info('Telegram Mariah registrado: /telegram/webhook | /telegram/status');
}

module.exports = { registerTelegramMariah, handleTelegramUpdate };
