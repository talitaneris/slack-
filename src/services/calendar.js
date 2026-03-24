'use strict';

/**
 * Serviço Google Calendar — usado pela Mariah para ler e gerenciar a agenda da Talita.
 *
 * Variáveis de ambiente necessárias:
 *   GOOGLE_CLIENT_ID      — ID do cliente OAuth2
 *   GOOGLE_CLIENT_SECRET  — Secret do cliente OAuth2
 *   GOOGLE_REFRESH_TOKEN  — Token de refresh (gerado uma vez pelo script scripts/google-auth.js)
 *   GOOGLE_CALENDAR_ID    — ID do calendário (padrão: 'primary')
 */

const { google } = require('googleapis');

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

/**
 * Retorna um cliente OAuth2 autenticado.
 * Retorna null se as credenciais não estiverem configuradas.
 */
function getAuth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return null;
  }
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return auth;
}

/**
 * Lista eventos da agenda dentro de um intervalo.
 * @param {Date} inicio - Data/hora de início
 * @param {Date} fim    - Data/hora de fim
 * @returns {string} Texto formatado com os eventos ou mensagem de agenda vazia
 */
async function listarEventos(inicio, fim) {
  try {
    const auth = getAuth();
    if (!auth) return '⚠️ Google Calendar não configurado.';

    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: inicio.toISOString(),
      timeMax: fim.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });

    const eventos = res.data.items || [];
    if (eventos.length === 0) return '📭 Agenda livre nesse período.';

    return eventos.map(ev => {
      const inicio = ev.start.dateTime
        ? new Date(ev.start.dateTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
        : 'dia todo';
      return `• ${inicio} — ${ev.summary}${ev.location ? ` (${ev.location})` : ''}`;
    }).join('\n');

  } catch (err) {
    console.error('[calendar] Erro ao listar eventos:', err.message);
    return `❌ Erro ao consultar agenda: ${err.message}`;
  }
}

/**
 * Cria um evento na agenda.
 * @param {string} titulo   - Nome do evento
 * @param {Date}   inicio   - Data/hora de início
 * @param {Date}   fim      - Data/hora de fim
 * @param {string} descricao - Descrição opcional
 * @returns {string} Confirmação ou erro
 */
async function criarEvento(titulo, inicio, fim, descricao = '') {
  try {
    const auth = getAuth();
    if (!auth) return '⚠️ Google Calendar não configurado.';

    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: titulo,
        description: descricao,
        start: { dateTime: inicio.toISOString(), timeZone: 'America/Sao_Paulo' },
        end:   { dateTime: fim.toISOString(),   timeZone: 'America/Sao_Paulo' },
      },
    });

    const link = res.data.htmlLink;
    const hora = inicio.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `✅ Evento criado: *${titulo}* — ${hora}\n🔗 ${link}`;

  } catch (err) {
    console.error('[calendar] Erro ao criar evento:', err.message);
    return `❌ Erro ao criar evento: ${err.message}`;
  }
}

/**
 * Deleta um evento pelo ID.
 */
async function deletarEvento(eventId) {
  try {
    const auth = getAuth();
    if (!auth) return '⚠️ Google Calendar não configurado.';

    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
    return '✅ Evento removido da agenda.';
  } catch (err) {
    return `❌ Erro ao remover evento: ${err.message}`;
  }
}

/**
 * Busca eventos por texto para encontrar o ID antes de editar/deletar.
 */
async function buscarEvento(termo, dias = 30) {
  try {
    const auth = getAuth();
    if (!auth) return [];

    const calendar = google.calendar({ version: 'v3', auth });
    const agora = new Date();
    const fim   = new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000);

    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      q: termo,
      timeMin: agora.toISOString(),
      timeMax: fim.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 5,
    });

    return res.data.items || [];
  } catch {
    return [];
  }
}

module.exports = { listarEventos, criarEvento, deletarEvento, buscarEvento };
