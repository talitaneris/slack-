'use strict';

/**
 * Serviço Google Calendar — usado pela Mariah para ler e gerenciar a agenda da Talita.
 *
 * Variáveis de ambiente necessárias:
 *   GOOGLE_CLIENT_ID      — ID do cliente OAuth2
 *   GOOGLE_CLIENT_SECRET  — Secret do cliente OAuth2
 *   GOOGLE_REFRESH_TOKEN  — Token de refresh (gerado uma vez pelo script scripts/google-auth.js)
 *   GOOGLE_CALENDAR_ID    — ID do calendário, ou 'all' para ler todas as agendas
 *   GOOGLE_CALENDAR_WRITE_ID — ID do calendário usado para criar eventos (padrão: 'primary')
 */

const { google } = require('googleapis');

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const WRITE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_WRITE_ID || 'primary';

const CALENDAR_ROUTES = {
  saude: process.env.GOOGLE_CALENDAR_SAUDE_ID || '4ff3b2194e9642783c6016eba59b647f776e8eac63b29488b11f923f75365da9@group.calendar.google.com',
  conteudo: process.env.GOOGLE_CALENDAR_CONTEUDO_ID || '015965a5a3092b4add5977257ab433f1d8df831a2ce97e2744ce1c1f8913cd17@group.calendar.google.com',
  mentoria: process.env.GOOGLE_CALENDAR_MENTORIA_ID || '548525d3ec1b96916132377efae9bb5fa65918b31aa4bd80d7342581e9ea64d9@group.calendar.google.com',
  pessoal: process.env.GOOGLE_CALENDAR_PESSOAL_ID || '829be334ad2a458e0e663871311a4a31030203de45d5681a048be138869a43b0@group.calendar.google.com',
  vendas: process.env.GOOGLE_CALENDAR_VENDAS_ID || '59052868f8deb11a8058f5fedc0e303b9057fa30ff753b7f69954ed90083fece@group.calendar.google.com',
  casa: process.env.GOOGLE_CALENDAR_CASA_ID || '2bd6305fef2d15792b0dfab81bbb3740c5ab34e6901812148ffd5a6d96a821dc@group.calendar.google.com',
  principal: process.env.GOOGLE_CALENDAR_PRINCIPAL_ID || 'contato@talitaneris.com.br',
};

function normalizeText(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function inferCalendarRoute(titulo = '', descricao = '') {
  const text = normalizeText(`${titulo} ${descricao}`);

  const matches = words => words.some(word => text.includes(word));

  if (matches([
    'pilates', 'treino', 'treinar', 'musculacao', 'cardio', 'yoga', 'hot yoga',
    'medico', 'medica', 'consulta', 'exame', 'nutri', 'nutricionista',
    'psicologa', 'psicologo', 'terapia', 'dentista', 'estetica', 'saude',
  ])) return { key: 'saude', calendarId: CALENDAR_ROUTES.saude, label: 'Saúde' };

  if (matches([
    'conteudo', 'gravar', 'gravacao', 'roteiro', 'reels', 'post', 'posts',
    'story', 'stories', 'carrossel', 'canva', 'copy', 'editorial',
  ])) return { key: 'conteudo', calendarId: CALENDAR_ROUTES.conteudo, label: 'Conteúdo | TNERIS Digital' };

  if (matches([
    'mentoria', 'mentorad', 'tribus', 'a tribus', 'aula', 'aluna', 'cliente',
    'sessao', 'direcionamento', 'grupo',
  ])) return { key: 'mentoria', calendarId: CALENDAR_ROUTES.mentoria, label: 'Mentoria A Tribus | Calendário' };

  if (matches([
    'venda', 'vendas', 'comercial', 'lead', 'leads', 'diagnostico', 'call',
    'reuniao de venda', 'fechamento', 'proposta', 'pipeline',
  ])) return { key: 'vendas', calendarId: CALENDAR_ROUTES.vendas, label: 'Vendas | TNERIS Digital' };

  if (matches([
    'me arrumar', 'arrumar', 'cafe', 'almoco', 'jantar', 'amiga', 'amigo',
    'familia', 'sair', 'salão', 'salao', 'unha', 'cabelo', 'pessoal',
  ])) return { key: 'pessoal', calendarId: CALENDAR_ROUTES.pessoal, label: 'Pessoal' };

  if (matches([
    'mercado', 'casa', 'rotina', 'limpeza', 'compras', 'farmacia',
  ])) return { key: 'casa', calendarId: CALENDAR_ROUTES.casa, label: 'Casa & Rotina' };

  return { key: 'principal', calendarId: WRITE_CALENDAR_ID === 'primary' ? CALENDAR_ROUTES.principal : WRITE_CALENDAR_ID, label: 'TNERIS Digital' };
}

async function getReadableCalendarIds(calendar) {
  if (CALENDAR_ID !== 'all') return [{ id: CALENDAR_ID, summary: '' }];

  const res = await calendar.calendarList.list({
    minAccessRole: 'reader',
    showHidden: false,
  });

  return (res.data.items || [])
    .filter(item => item.id)
    .map(item => ({
      id: item.id,
      summary: item.summary || item.id,
    }));
}

function formatEvent(ev, calendarName = '') {
  const inicio = ev.start.dateTime
    ? new Date(ev.start.dateTime).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    })
    : 'dia todo';

  const origem = calendarName ? ` [${calendarName}]` : '';
  return `• ${inicio} — ${ev.summary || 'Sem título'}${origem}${ev.location ? ` (${ev.location})` : ''}`;
}

/**
 * Retorna um cliente OAuth2 autenticado.
 * Retorna null se as credenciais não estiverem configuradas.
 */
function getAuth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    console.warn('[calendar] Credenciais ausentes:', {
      id: !!GOOGLE_CLIENT_ID,
      secret: !!GOOGLE_CLIENT_SECRET,
      token: !!GOOGLE_REFRESH_TOKEN
    });
    return null;
  }
  console.log('[calendar] Credenciais presentes — ID termina em:', GOOGLE_CLIENT_ID.slice(-20));
  const auth = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'https://slack-soab.onrender.com/google/callback'
  );
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
    if (!auth) return 'Google Calendar não configurado.';

    const calendar = google.calendar({ version: 'v3', auth });
    const calendars = await getReadableCalendarIds(calendar);
    const eventosPorAgenda = await Promise.all(calendars.map(async agenda => {
      try {
        const res = await calendar.events.list({
          calendarId: agenda.id,
          timeMin: inicio.toISOString(),
          timeMax: fim.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 20,
        });

        return (res.data.items || []).map(ev => ({
          ev,
          calendarName: CALENDAR_ID === 'all' ? agenda.summary : '',
          start: ev.start.dateTime || ev.start.date || '',
        }));
      } catch (err) {
        console.warn('[calendar] Agenda ignorada:', agenda.summary || agenda.id, err.message);
        return [];
      }
    }));

    const eventos = eventosPorAgenda
      .flat()
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    if (eventos.length === 0) return 'Agenda livre nesse período.';

    return eventos
      .slice(0, 30)
      .map(({ ev, calendarName }) => formatEvent(ev, calendarName))
      .join('\n');

  } catch (err) {
    console.error('[calendar] Erro ao listar eventos:', err.message);
    return `Erro ao consultar agenda: ${err.message}`;
  }
}

async function listarAgendasDisponiveis() {
  try {
    const auth = getAuth();
    if (!auth) return 'Google Calendar não configurado.';

    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.calendarList.list({
      minAccessRole: 'reader',
      showHidden: true,
    });

    const agendas = res.data.items || [];
    if (agendas.length === 0) return 'Não encontrei nenhuma agenda acessível nessa conta Google.';

    return agendas.map(item => {
      const flags = [
        item.primary ? 'principal' : '',
        item.hidden ? 'oculta' : '',
        item.accessRole ? `acesso: ${item.accessRole}` : '',
      ].filter(Boolean).join(', ');

      return `• ${item.summary || item.id}${flags ? ` (${flags})` : ''}\n  ID: ${item.id}`;
    }).join('\n');
  } catch (err) {
    console.error('[calendar] Erro ao listar agendas:', err.message);
    return `Erro ao listar agendas: ${err.message}`;
  }
}

async function diagnosticarEventos(inicio, fim) {
  try {
    const auth = getAuth();
    if (!auth) return 'Google Calendar não configurado.';

    const calendar = google.calendar({ version: 'v3', auth });
    const agendas = await getReadableCalendarIds(calendar);
    const linhas = [];

    for (const agenda of agendas) {
      try {
        const res = await calendar.events.list({
          calendarId: agenda.id,
          timeMin: inicio.toISOString(),
          timeMax: fim.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 10,
        });

        const eventos = res.data.items || [];
        if (eventos.length === 0) {
          linhas.push(`• ${agenda.summary || agenda.id}: 0 eventos`);
          continue;
        }

        linhas.push(`• ${agenda.summary || agenda.id}: ${eventos.length} evento(s)`);
        eventos.forEach(ev => {
          const hora = ev.start.dateTime
            ? new Date(ev.start.dateTime).toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
              hour: '2-digit',
              minute: '2-digit',
            })
            : 'dia todo';
          linhas.push(`  - ${hora} — ${ev.summary || 'Sem título'}`);
        });
      } catch (err) {
        linhas.push(`• ${agenda.summary || agenda.id}: erro - ${err.message}`);
      }
    }

    return linhas.join('\n');
  } catch (err) {
    return `Erro no diagnóstico da agenda: ${err.message}`;
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
    if (!auth) return 'Google Calendar não configurado.';

    const calendar = google.calendar({ version: 'v3', auth });
    const route = inferCalendarRoute(titulo, descricao);
    const res = await calendar.events.insert({
      calendarId: route.calendarId,
      requestBody: {
        summary: titulo,
        description: descricao,
        start: { dateTime: inicio.toISOString(), timeZone: 'America/Sao_Paulo' },
        end:   { dateTime: fim.toISOString(),   timeZone: 'America/Sao_Paulo' },
      },
    });

    const link = res.data.htmlLink;
    const hora = inicio.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `Evento criado em *${route.label}*: *${titulo}* — ${hora}\n${link}`;

  } catch (err) {
    console.error('[calendar] Erro ao criar evento:', err.message);
    return `Erro ao criar evento: ${err.message}`;
  }
}

/**
 * Deleta um evento pelo ID.
 */
async function deletarEvento(eventId, calendarId = WRITE_CALENDAR_ID) {
  try {
    const auth = getAuth();
    if (!auth) return 'Google Calendar não configurado.';

    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId, eventId });
    return 'Evento removido da agenda.';
  } catch (err) {
    return `Erro ao remover evento: ${err.message}`;
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
    const calendars = await getReadableCalendarIds(calendar);
    const results = await Promise.all(calendars.map(async agenda => {
      try {
        const res = await calendar.events.list({
          calendarId: agenda.id,
          q: termo,
          timeMin: agora.toISOString(),
          timeMax: fim.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 5,
        });

        return (res.data.items || []).map(ev => ({
          ...ev,
          calendarId: agenda.id,
          calendarName: agenda.summary || agenda.id,
        }));
      } catch {
        return [];
      }
    }));

    return results
      .flat()
      .sort((a, b) => String(a.start?.dateTime || a.start?.date || '').localeCompare(String(b.start?.dateTime || b.start?.date || '')))
      .slice(0, 10);
  } catch {
    return [];
  }
}

module.exports = {
  listarEventos,
  listarAgendasDisponiveis,
  diagnosticarEventos,
  criarEvento,
  deletarEvento,
  buscarEvento,
};
