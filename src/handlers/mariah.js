'use strict';

/**
 * Handler especializado para a Mariah — detecta intenções de agenda
 * e executa ações reais no Google Calendar da Talita.
 *
 * Fluxo:
 * 1. Claude (Mariah) analisa a mensagem e retorna JSON com a ação + resposta
 * 2. Este handler executa a ação no Google Calendar
 * 3. Resultado é postado no Slack
 */

const { callClaude }    = require('../claude');
const { listarEventos, criarEvento, deletarEvento, buscarEvento } = require('../services/calendar');

// System prompt especial que faz a Mariah retornar JSON estruturado para ações de agenda
const MARIAH_CALENDAR_SYSTEM = `Você é Mariah, secretária pessoal da Talita. Analise a mensagem e retorne APENAS um JSON válido (sem markdown, sem texto extra).

AGENDA FIXA DA TALITA (nunca agendar por cima):
- Treinos: seg/qua/sex 8h30–9h30
- A Tribus: segunda 19h
- Gravações: quinta (dia protegido)
- Folga: sexta (zero compromissos profissionais)

Formato da resposta:
{
  "acao": "listar" | "criar" | "deletar" | "buscar" | "nenhuma",
  "resposta": "mensagem para Talita (texto natural, pode usar markdown Slack)",
  "dados": {
    // Para "listar": { "inicio": "ISO8601", "fim": "ISO8601" }
    // Para "criar":  { "titulo": "string", "inicio": "ISO8601", "fim": "ISO8601", "descricao": "string" }
    // Para "deletar" ou "buscar": { "termo": "string" }
    // Para "nenhuma": {}
  }
}

Data/hora de AGORA (BRT): ${new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16)}

REGRAS:
- Se não há conflito com agenda fixa: execute e confirme
- Se há conflito: recuse e sugira horário alternativo
- Para "listar hoje": inicio = início do dia, fim = final do dia
- Para "listar semana": inicio = hoje, fim = daqui 7 dias
- Duração padrão de reunião: 1 hora (se não especificado)
- Sempre use timezone America/Sao_Paulo nos cálculos`;

/**
 * Detecta se a mensagem é relacionada à agenda.
 */
function isAgendaRequest(text) {
  const palavras = ['agenda', 'agendar', 'reunião', 'reuniao', 'compromisso', 'horário', 'horario',
    'cancelar', 'cancela', 'marcar', 'marca', 'desmarca', 'remarca', 'hoje', 'amanhã',
    'amanha', 'semana', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'calendario',
    'calendário', 'disponível', 'disponivel', 'livre', 'ocupada'];
  const lower = text.toLowerCase();
  return palavras.some(p => lower.includes(p));
}

/**
 * Processa uma mensagem da Mariah com intenção de agenda.
 * Retorna { text, calendarResult } onde text é a resposta para o Slack.
 */
async function processMariahCalendar(userMessage, systemPrompt) {
  // Verifica se há intenção de agenda
  if (!isAgendaRequest(userMessage)) return null;

  // Verifica se Google Calendar está configurado
  if (!process.env.GOOGLE_REFRESH_TOKEN) return null;

  try {
    // Pede à Mariah para estruturar a ação em JSON
    const raw = await callClaude(MARIAH_CALENDAR_SYSTEM, userMessage, 600);

    // Extrai o JSON da resposta (remove markdown se o modelo adicionou)
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed  = JSON.parse(jsonStr);

    const { acao, resposta, dados } = parsed;

    // Executa a ação no Google Calendar
    let calendarResult = '';

    if (acao === 'listar' && dados.inicio && dados.fim) {
      calendarResult = await listarEventos(new Date(dados.inicio), new Date(dados.fim));
    }

    if (acao === 'criar' && dados.titulo && dados.inicio) {
      // Verifica conflito com agenda fixa antes de criar
      const fim = dados.fim || new Date(new Date(dados.inicio).getTime() + 60 * 60 * 1000).toISOString();
      calendarResult = await criarEvento(dados.titulo, new Date(dados.inicio), new Date(fim), dados.descricao || '');
    }

    if (acao === 'deletar' && dados.termo) {
      const eventos = await buscarEvento(dados.termo);
      if (eventos.length === 0) {
        calendarResult = `Não encontrei nenhum evento com "${dados.termo}" nos próximos 30 dias.`;
      } else if (eventos.length === 1) {
        calendarResult = await deletarEvento(eventos[0].id);
      } else {
        // Mais de um resultado — pede confirmação
        const lista = eventos.map((e, i) => `${i + 1}. ${e.summary} — ${new Date(e.start.dateTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`).join('\n');
        calendarResult = `Encontrei mais de um evento. Qual deles?\n${lista}`;
      }
    }

    if (acao === 'buscar' && dados.termo) {
      const eventos = await buscarEvento(dados.termo);
      if (eventos.length === 0) {
        calendarResult = `Nenhum evento encontrado com "${dados.termo}".`;
      } else {
        calendarResult = eventos.map(e => {
          const hora = e.start.dateTime
            ? new Date(e.start.dateTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
            : 'dia todo';
          return `• ${hora} — ${e.summary}`;
        }).join('\n');
      }
    }

    // Monta resposta final
    const textoFinal = calendarResult
      ? `${resposta}\n\n📅 *Agenda:*\n${calendarResult}`
      : resposta;

    return textoFinal;

  } catch (err) {
    console.error('[mariah] Erro ao processar agenda:', err.message);
    return null; // fallback para resposta normal da Mariah
  }
}

module.exports = { processMariahCalendar, isAgendaRequest };
