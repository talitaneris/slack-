'use strict';

const crypto = require('crypto');
const { getZoomAccessToken, buscarGravacaoZoom, downloadRecording, isZoomConfigured } = require('../services/zoom');
const { isYouTubeConfigured, uploadToYouTube } = require('../services/youtube');
const { sendTelegramMessage } = require('../telegram/mariah');

// Verifica assinatura HMAC-SHA256 do Zoom.
// Zoom computa o HMAC sobre o body raw em string — aqui usamos o body já parseado
// re-stringificado, o que funciona quando a ordem das chaves é preservada.
// Para verificação perfeita, use um middleware de raw body.
function verifyZoomWebhook(req) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) return true;

  const timestamp = req.headers['x-zm-request-timestamp'];
  const signature = req.headers['x-zm-signature'];
  if (!timestamp || !signature) return false;

  const message = `v0:${timestamp}:${JSON.stringify(req.body)}`;
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(message).digest('hex');
  return expected === signature;
}

async function processRecordingCompleted(payload, logger) {
  const object = payload.object || {};
  const meetingId = object.id;
  const topic = object.topic || 'Reunião';
  const recordings = object.recording_files || [];
  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;

  const mp4Files = recordings.filter(f => f.file_type === 'MP4' && f.status === 'completed');
  if (mp4Files.length === 0) {
    logger.warn('[zoom-webhook] Nenhum MP4 na gravação do meeting', meetingId);
    return;
  }

  const file = mp4Files[0];

  try {
    logger.info('[zoom-webhook] Baixando gravação:', file.download_url);
    const accessToken = await getZoomAccessToken();
    const buffer = await downloadRecording(file.download_url, accessToken);

    let youtubeUrl = null;

    if (isYouTubeConfigured()) {
      logger.info('[zoom-webhook] Upload para YouTube...');
      const dataBR = new Date().toLocaleDateString('pt-BR');
      youtubeUrl = await uploadToYouTube({
        title: `${topic} — ${dataBR}`,
        description: `Gravação automática: ${topic}`,
        buffer,
      });
      logger.info('[zoom-webhook] Upload concluído:', youtubeUrl);
    } else {
      logger.warn('[zoom-webhook] YOUTUBE_REFRESH_TOKEN ausente — upload pulado');
    }

    if (chatId && process.env.TELEGRAM_BOT_TOKEN) {
      const msg = youtubeUrl
        ? `🎬 *Gravação disponível — ${topic}*\n\n📺 ${youtubeUrl}`
        : `🎬 *Gravação processada — ${topic}*\n\n_Configure YOUTUBE_REFRESH_TOKEN no Render para upload automático._`;
      await sendTelegramMessage(chatId, msg);
    }

  } catch (err) {
    logger.error('[zoom-webhook] Erro ao processar gravação:', err.message);
    if (chatId && process.env.TELEGRAM_BOT_TOKEN) {
      await sendTelegramMessage(chatId, `⚠️ Gravação do Zoom falhou no processamento: ${err.message}`).catch(() => {});
    }
  }
}

function registerZoomWebhook(receiver, logger = console) {
  receiver.router.post('/zoom/webhook', async (req, res) => {
    const body = req.body || {};

    // Validação de URL — Zoom chama isso ao ativar o webhook no painel
    if (body.event === 'endpoint.url_validation') {
      const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
      if (!secret) {
        return res.status(400).json({ error: 'ZOOM_WEBHOOK_SECRET_TOKEN ausente' });
      }
      const plainToken = body.payload?.plainToken || '';
      const encryptedToken = crypto.createHmac('sha256', secret).update(plainToken).digest('hex');
      return res.status(200).json({ plainToken, encryptedToken });
    }

    if (!verifyZoomWebhook(req)) {
      return res.status(401).json({ error: 'Zoom webhook signature inválida' });
    }

    // Responde 200 imediatamente — processamento é assíncrono
    res.status(200).json({ ok: true });

    if (body.event === 'recording.completed') {
      processRecordingCompleted(body.payload, logger).catch(err => {
        logger.error('[zoom-webhook] Erro não tratado:', err.message);
      });
    }
  });

  logger.info('Zoom webhook registrado: POST /zoom/webhook');
}

module.exports = { registerZoomWebhook };
