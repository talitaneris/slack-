'use strict';

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');

function isYouTubeConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.YOUTUBE_REFRESH_TOKEN
  );
}

function getYouTubeAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
  auth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
  return auth;
}

function getYouTube() {
  return google.youtube({ version: 'v3', auth: getYouTubeAuth() });
}

// ─── UPLOAD ───────────────────────────────────────────────────

async function uploadToYouTube({ title, description = '', buffer }) {
  if (!isYouTubeConfigured()) {
    throw new Error('YouTube não configurado — adicione YOUTUBE_REFRESH_TOKEN no Render');
  }

  const tmpPath = path.join(os.tmpdir(), `${randomUUID()}.mp4`);
  fs.writeFileSync(tmpPath, buffer);

  try {
    const youtube = getYouTube();
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          defaultLanguage: 'pt',
          defaultAudioLanguage: 'pt',
        },
        status: { privacyStatus: 'unlisted' },
      },
      media: {
        mimeType: 'video/mp4',
        body: fs.createReadStream(tmpPath),
      },
    });

    const videoId = response.data.id;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ─── LISTAR VÍDEOS DO CANAL ───────────────────────────────────

async function listChannelVideos(maxResults = 50) {
  const youtube = getYouTube();

  // Pega o ID da playlist de uploads do canal
  const channelRes = await youtube.channels.list({
    part: ['contentDetails', 'snippet'],
    mine: true,
  });

  const channel = channelRes.data.items?.[0];
  if (!channel) throw new Error('Canal não encontrado');

  const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
  const channelTitle = channel.snippet.title;

  // Lista os vídeos da playlist de uploads
  const videos = [];
  let pageToken = null;

  do {
    const res = await youtube.playlistItems.list({
      part: ['snippet', 'contentDetails'],
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(maxResults - videos.length, 50),
      pageToken: pageToken || undefined,
    });

    for (const item of res.data.items || []) {
      videos.push({
        id: item.contentDetails.videoId,
        title: item.snippet.title,
        description: item.snippet.description?.slice(0, 300) || '',
        publishedAt: item.snippet.publishedAt,
        url: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`,
      });
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken && videos.length < maxResults);

  return { channelTitle, videos };
}

// ─── LEGENDAS / TRANSCRIÇÃO ───────────────────────────────────

async function getVideoTranscript(videoId) {
  const youtube = getYouTube();

  try {
    // Lista as faixas de legenda disponíveis
    const captionsRes = await youtube.captions.list({
      part: ['snippet'],
      videoId,
    });

    const tracks = captionsRes.data.items || [];
    if (tracks.length === 0) return null;

    // Prefere pt-BR, depois pt, depois qualquer uma
    const track =
      tracks.find(t => t.snippet.language === 'pt-BR') ||
      tracks.find(t => t.snippet.language === 'pt') ||
      tracks.find(t => t.snippet.trackKind === 'asr') || // auto-gerada
      tracks[0];

    if (!track) return null;

    // Baixa a legenda em formato srt
    const downloadRes = await youtube.captions.download({
      id: track.id,
      tfmt: 'srt',
    }, { responseType: 'text' });

    const srt = typeof downloadRes.data === 'string'
      ? downloadRes.data
      : JSON.stringify(downloadRes.data);

    // Limpa o formato SRT — remove timestamps e índices
    const texto = srt
      .replace(/\d+\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/g, '')
      .replace(/\n{3,}/g, '\n')
      .trim();

    return texto.slice(0, 8000); // limita para não explodir o contexto
  } catch {
    return null; // sem legenda disponível
  }
}

// ─── ANÁLISE VS METODOLOGIA A TRIBUS ─────────────────────────

const METODOLOGIA_A_TRIBUS = `
AQUECIMENTO: Reposicionamento de mentalidade para vender.
FASE 1 — POSICIONE PARA VENDER:
  - Posicionamento: diferenciação, público certo, produto com percepção de valor, comunicação estratégica
  - Conteúdo: perfil como vitrine, linha editorial, feed que converte, stories que vendem
  - Leads: venda silenciosa por stories, link na bio com Typebot, social selling
  - Meta: 2-5 primeiras vendas, perfil estratégico pronto

FASE 2 — ESCALE SUAS VENDAS:
  - Posicionamento: validação de ICP, lacuna de mercado, produto de entrada/expansão
  - Conteúdo: estratégias validadas, calendário editorial, copy de influência, métricas
  - Leads: workshop, live, Manychat, qualificação diária, social selling em volume
  - Meta: 10 leads/dia, 3 vendas/semana com consistência

FASE 3 — DELEGUE E ESCALE:
  - Posicionamento: manual de marca, história da marca, escada de valor, comunicação replicável
  - Conteúdo: processo delegável, direção editorial com padrão, banco de ideias, acervo
  - Leads: scripts de social selling, sequência de WhatsApp, funis automatizados, onboarding
  - Otimização: métricas, gestão de clientes, ciclos de evolução comercial
  - Meta: R$100k/mês com previsibilidade, time operando, comunidade rodando
`;

async function analisarAulasVsMetodologia({ callClaudeFn, maxVideos = 30 }) {
  if (!isYouTubeConfigured()) {
    return 'YouTube não configurado. Adicione YOUTUBE_REFRESH_TOKEN no Render.';
  }

  // 1. Lista os vídeos
  const { channelTitle, videos } = await listChannelVideos(maxVideos);
  if (videos.length === 0) return 'Nenhum vídeo encontrado no canal.';

  // 2. Tenta buscar transcrições (processa em lotes para não demorar demais)
  const aulasComConteudo = [];
  for (const video of videos) {
    const transcript = await getVideoTranscript(video.id).catch(() => null);
    aulasComConteudo.push({
      titulo: video.title,
      url: video.url,
      data: video.publishedAt?.slice(0, 10) || '',
      conteudo: transcript || video.description || '(sem transcrição disponível)',
    });
  }

  // 3. Monta o resumo das aulas para o Claude
  const resumoAulas = aulasComConteudo.map((a, i) =>
    `[${i + 1}] ${a.titulo} (${a.data})\n${a.conteudo.slice(0, 600)}`
  ).join('\n\n---\n\n');

  // 4. Envia para Claude analisar
  const system = `Você é uma consultora especialista em método A Tribus. Analise as aulas do canal do YouTube da Talita e compare com a estrutura do método.

MÉTODO A TRIBUS:
${METODOLOGIA_A_TRIBUS}

Gere um relatório com:
1. **O que já foi ensinado** — mapeia cada aula para a fase/módulo do método
2. **Gaps** — o que está no método mas ainda não tem aula
3. **O que está repetido** — temas ensinados múltiplas vezes
4. **Ordem sugerida** — se as aulas estão na sequência certa do método
5. **Próximas aulas prioritárias** — o que gravar primeiro para completar o método

Seja específica. Cite nomes de aulas. Máximo 600 palavras.`;

  const prompt = `Canal: ${channelTitle}\nTotal de aulas analisadas: ${aulasComConteudo.length}\n\n${resumoAulas.slice(0, 12000)}`;

  const relatorio = await callClaudeFn(system, prompt, 1500);
  return relatorio;
}

module.exports = {
  isYouTubeConfigured,
  uploadToYouTube,
  listChannelVideos,
  getVideoTranscript,
  analisarAulasVsMetodologia,
};
