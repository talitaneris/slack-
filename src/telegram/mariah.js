'use strict';

const { AGENTS } = require('../agents');
const { callClaude } = require('../claude');
const { processMariahCalendar } = require('../handlers/mariah');
const { buildMariahMemoryContext, registrarNaMemoria } = require('../memory/mariah');
const { getPrivateContextForAgent } = require('../privateContext');
const { listarEventos } = require('../services/calendar');
const { listarEmailsManha, isEmailConfigured, enviarEmail } = require('../services/email');
const { criarReuniaoZoom, isZoomConfigured } = require('../services/zoom');

const TELEGRAM_API = 'https://api.telegram.org';

// ─── COORDENAÇÃO COM O SQUAD ──────────────────────────────────

const AGENT_CHANNEL_MAP = {
  nara:   { channel: 'C0AN20EFA02', label: 'Nara' },
  jay:    { channel: 'C03PX3KKTJS', label: 'Jay' },
  sofia:  { channel: 'C0AMZU5RFM4', label: 'Sofia' },
  people: { channel: 'C0AMR167B4L', label: 'People' },
  vega:   { channel: 'C0AMR167B4L', label: 'Vega' },
  lia:    { channel: 'C0AMJ13D85T', label: 'Lia' },
  mari:   { channel: 'C0AMR126AN8', label: 'Mari' },
  paulo:  { channel: 'C0AMR126AN8', label: 'Paulo' },
  alex:   { channel: 'C0AMR167B4L', label: 'Alex' },
  lens:   { channel: 'C03PX3KKTJS', label: 'Lens' },
  marta:  { channel: 'C0AN20EFA02', label: 'Marta' },
};

let _slackClient = null;

async function detectarEDelegarSquad(userText, mariahResponse, logger) {
  if (!_slackClient) return;
  const lower = mariahResponse.toLowerCase();
  const mencionados = Object.keys(AGENT_CHANNEL_MAP).filter(n => lower.includes(n));
  if (mencionados.length === 0) return;

  try {
    const raw = await callClaude(
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

async function buildMariahSystem() {
  const agent = AGENTS.assistente;
  let system = [
    'Agora em America/Sao_Paulo: ' + getBrtNow() + '.',
    'CANAL: Telegram. Voce e a Mariah, agente executiva da Talita.',
    'Telegram e porta de entrada rapida: mensagem curta, audio, ideia solta, comando pessoal, rotina.',
    'Formato preferido: Entendi / Vou organizar assim / Depende de voce apenas se houver decisao sua.',
    '',
    'NIVEIS DE AUTONOMIA:',
    'FAZ SOZINHA (sem perguntar): triagem de email, agenda, link Zoom, resumos, organizar informacao, responder padrao conhecido.',
    'AVISA ANTES (pergunta primeiro): responder por Talita para terceiros, aprovar conteudo, envolver cliente ou parceiro.',
    'NAO TOCA NUNCA: contratos, pagamentos, decisoes estrategicas, posicionamento, definir preco.',
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
  ].join('\n');

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
  const lower = text.toLowerCase();
  if (lower.includes('zoom')) return true;
  if (lower.includes('link') && (lower.includes('reuniao') || lower.includes('reunião') || lower.includes('meeting'))) return true;
  if ((lower.includes('criar') || lower.includes('gera') || lower.includes('abre')) && (lower.includes('reuniao') || lower.includes('reunião') || lower.includes('meeting'))) return true;
  return false;
}

async function processMariahText(userText, source) {
  const lowerText = userText.toLowerCase();
  const emailTriggers = ['email', 'e-mail', 'caixa', 'inbox', 'mensagens do email', 'correio', 'zoho', 'listar email', 'ver email', 'meus emails'];
  const pedindoEmail = emailTriggers.some(t => lowerText.includes(t));

  if (isBriefingRequest(userText)) {
    try {
      const system = await buildMariahSystem();
      const prompt = await buildManualBriefingPrompt();
      const response = await callClaude(system, prompt, 650);
      return formatForTelegram(response);
    } catch (err) {
      return formatForTelegram('A consulta de agenda ou e-mail falhou. Vou acionar Nara para diagnosticar conexão de Google Calendar e Zoho.');
    }
  }

  if (pedindoEmail && isEmailConfigured()) {
    try {
      const emails = await listarEmailsManha({ limit: 12, hours: 24 });
      const system = await buildMariahSystem();
      const prompt = `Aqui estão os e-mails recentes da Talita:\n\n${emails}\n\nResuma de forma clara e humana, como uma assistente executiva faria. Destaque o que precisa de atenção urgente, o que é financeiro importante e o que pode ignorar. Seja direta, sem emoji e sem título com seu nome.`;
      const response = await callClaude(system, prompt, 600);
      return formatForTelegram(response);
    } catch (err) {
      return formatForTelegram('Erro ao buscar e-mails. Tente novamente.');
    }
  }

  if (isZoomRequest(userText) && isZoomConfigured()) {
    const lowerZoom = userText.toLowerCase();
    const isIndividual = lowerZoom.includes('individual') || lowerZoom.includes('1:1') || lowerZoom.includes('one on one');
    const emailMatch = userText.match(/[\w.+\-]+@[\w.\-]+\.\w+/);

    // Reunião individual sem e-mail → pede o e-mail antes de criar
    if (isIndividual && !emailMatch) {
      return formatForTelegram('Qual é o e-mail da participante? Assim eu já envio o link direto para ela.');
    }

    try {
      const meeting = await criarReuniaoZoom({ topic: 'Reunião' });
      let reply = `🎥 *Zoom criado!*\n\n🔗 ${meeting.joinUrl}\n🔑 Senha: ${meeting.password || 'sem senha'}\n📋 ID: \`${meeting.meetingId}\``;

      if (emailMatch && isEmailConfigured()) {
        try {
          await enviarEmail({
            to: emailMatch[0],
            subject: 'Link da sua reunião com Talita',
            body: `Olá!\n\nSegue o link para a sua reunião:\n\n${meeting.joinUrl}\nSenha: ${meeting.password || 'sem senha'}\n\nAté logo!`,
          });
          reply += `\n\n📧 Link enviado para ${emailMatch[0]}`;
        } catch (err) {
          reply += `\n\n⚠️ E-mail não enviado: ${err.message}`;
        }
      } else if (emailMatch) {
        reply += '\n\n_Configure ZOHO_OAUTH* no Render para envio de e-mail._';
      }

      return formatForTelegram(reply);
    } catch (err) {
      return formatForTelegram(`Erro ao criar reunião Zoom: ${err.message}`);
    }
  }

  const system = await buildMariahSystem();
  const calendarResponse = await processMariahCalendar(userText, system);
  const response = formatForTelegram(calendarResponse || await callClaude(system, userText, 600));

  // Registra na memória estruturada de forma assíncrona (não bloqueia a resposta)
  registrarNaMemoria(userText, response).catch(() => {});

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
  return {
    chatId: message.chat && message.chat.id,
    userId: message.from && message.from.id,
    firstName: message.from && message.from.first_name,
    text: text.trim(),
    hasVoice: !!voice,
    hasPhoto: !!photo,
    voiceFileId: (voice && voice.file_id) || null,
  };
}

function isAllowedChat(chatId) {
  const allowed = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!allowed) return true;
  return String(chatId) === String(allowed);
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
  if (!isAllowedChat(msg.chatId)) {
    logger.warn('Telegram bloqueado para chat_id=' + msg.chatId);
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
      await sendTelegramMessage(msg.chatId, 'Não consegui transcrever. Pode mandar em texto?');
      return;
    }
  }
  if (!userText && msg.hasPhoto) {
    userText = 'Talita enviou uma imagem no Telegram sem legenda. Responda como Mariah.';
  }
  if (!userText) return;
  const response = await processMariahText(userText, sourceIsVoice ? 'Audio' : 'Telegram');

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
    res.json({
      ok: true,
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      webhook: '/telegram/webhook',
      allowed_chat_configured: !!process.env.TELEGRAM_ALLOWED_CHAT_ID,
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

module.exports = { registerTelegramMariah, handleTelegramUpdate, setTelegramWebhook, sendTelegramMessage };
