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
​​​​​​​​}​​​​​​
