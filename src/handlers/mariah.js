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
const {
  listarEventos,
  listarAgendasDisponiveis,
  diagnosticarEventos,
  criarEvento,
  deletarEvento,
  buscarEvento,
} = require('../services/calendar');

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

function getBrtDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return {
    year: Number(parts.find(part => part.type === 'year').value),
    month: Number(parts.find(part => part.type === 'month').value),
    day: Number(parts.find(part => part.type === 'day').value),
  };
}

function addDaysBrt(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return getBrtDateParts(date);
}

function brtDateTime(parts, hour, minute = 0) {
  const yyyy = String(parts.year).padStart(4, '0');
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mi = String(minute).padStart(2, '0');
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00-03:00`);
}

function getDirectListRange(text) {
  const lower = text.toLowerCase();
  const isWriteAction = ['agendar', 'marcar', 'remarcar', 'cancelar', 'cancela', 'desmarcar', 'desmarca']
    .some(word => lower.includes(word));
  if (isWriteAction) return null;

  const asksAgenda = ['agenda', 'compromisso', 'compromissos', 'horário', 'horario', 'livre', 'ocupada', 'ocupado']
    .some(word => lower.includes(word));
  const asksSchedule = ['o que tenho', 'o que tem', 'meus horários', 'meus horarios', 'minha manhã', 'minha manha', 'meu dia']
    .some(phrase => lower.includes(phrase));
  const hasRelativeDate = lower.includes('hoje') || lower.includes('amanhã') || lower.includes('amanha');
  if (!asksAgenda && !(asksSchedule && hasRelativeDate)) return null;

  const today = getBrtDateParts();
  let target = today;
  let label = 'hoje';

  if (lower.includes('amanhã') || lower.includes('amanha')) {
    target = addDaysBrt(today, 1);
    label = 'amanhã';
  } else if (!lower.includes('hoje')) {
    return null;
  }

  let inicio = brtDateTime(target, 0);
  let fim = brtDateTime(addDaysBrt(target, 1), 0);
  let periodo = 'o dia todo';

  if (lower.includes('manhã') || lower.includes('manha')) {
    inicio = brtDateTime(target, 6);
    fim = brtDateTime(target, 12);
    periodo = 'pela manhã';
  } else if (lower.includes('tarde')) {
    inicio = brtDateTime(target, 12);
    fim = brtDateTime(target, 18);
    periodo = 'à tarde';
  } else if (lower.includes('noite')) {
    inicio = brtDateTime(target, 18);
    fim = brtDateTime(addDaysBrt(target, 1), 0);
    periodo = 'à noite';
  }

  return { inicio, fim, label, periodo };
}

function isCalendarDiagnosticRequest(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes('quais agendas') ||
    lower.includes('que agendas') ||
    lower.includes('agendas voce enxerga') ||
    lower.includes('agendas você enxerga') ||
    lower.includes('o que voce esta vendo') ||
    lower.includes('o que você está vendo') ||
    lower.includes('o que voce ve') ||
    lower.includes('o que você vê')
  );
}

function isEventDiagnosticRequest(text) {
  const lower = text.toLowerCase();
  return lower.includes('diagnosticar agenda') || lower.includes('diagnóstico agenda') || lower.includes('diagnostico agenda');
}

// System prompt especial que faz a Mariah retornar JSON estruturado para ações de agenda
function getMariahCalendarSystem() {
  return `Você é Mariah, agente executiva da Talita. Analise a mensagem e retorne APENAS um JSON válido (sem markdown, sem texto extra).

FONTE DA VERDADE:
- Google Calendar ao vivo vence rotina fixa, memoria antiga e suposicao.
- Rotina conhecida serve como alerta, nao como fato.
- Nunca afirme treino, aula, gravacao, folga ou dia livre sem consultar a agenda quando a pergunta for sobre agenda.
- Se o Google Calendar falhar, diga que falhou e diagnostique. Nao invente.

ORGANIZAÇÃO DAS AGENDAS:
- Saúde: musculação, pilates, hot yoga, atividade física, médico, nutricionista, exames, retornos e cuidados de saúde.
- Rotina / Casa: almoço, casa, organização, manutenção da vida e rotina básica.
- Pessoal: unha, sobrancelha, salão, café com amigas, se arrumar, amigos, família e compromissos pessoais.
- Conteúdo: gravar conteúdo, escrever, newsletter, posts, stories, reels, calendário editorial e conteúdo da Tijoleste.
- Vendas: ações de venda, leads, calls comerciais, fechamento, prospecção, propostas e pipeline.
- Atendimento: sessões, clientes, mentorados, acompanhamento, aulas ao vivo e entrega.
- TNERIS Digital: negócio geral quando não couber nas categorias acima.

SISTEMA DE PRODUTIVIDADE:
- Agenda = execução e blocos de tempo. Use quando leva tempo, exige foco ou precisa de horário.
- Lembretes = conferência, microtarefas e memória. Use quando é rápido, só precisa lembrar ou pode encaixar no dia.
- Check do dia = disciplina e consistência. Use para itens essenciais que Talita costuma esquecer ou precisa confirmar execução.
- Água fica como lembrete pessoal.
- Stories ficam como check mental, não bloco fixo.
- Relatório de cliente fica como lembrete rápido, não agenda.
- Contas ficam como lembrete recorrente.

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

Data/hora de AGORA em America/Sao_Paulo: ${getBrtNow()}

REGRAS:
- Se não há conflito com agenda fixa: execute e confirme
- Se há conflito: recuse e sugira horário alternativo
- Para "listar hoje": inicio = início do dia, fim = final do dia
- Para "listar semana": inicio = hoje, fim = daqui 7 dias
- Duração padrão de reunião: 1 hora (se não especificado)
- Sempre use timezone America/Sao_Paulo nos cálculos`;
}

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
    if (isCalendarDiagnosticRequest(userMessage)) {
      const agendas = await listarAgendasDisponiveis();
      return `Estou vendo estas agendas na conta Google conectada:\n\n${agendas}\n\nSe a agenda que você esperava não aparecer aqui, ela está em outra conta Google ou não foi compartilhada com esta conta.`;
    }

    const directRange = getDirectListRange(userMessage);
    if (directRange && isEventDiagnosticRequest(userMessage)) {
      const calendarResult = await diagnosticarEventos(directRange.inicio, directRange.fim);
      return `Diagnóstico de eventos para ${directRange.label}, ${directRange.periodo}:\n\n${calendarResult}`;
    }

    if (directRange) {
      const calendarResult = await listarEventos(directRange.inicio, directRange.fim);
      return `Vou verificar sua agenda de ${directRange.label}, ${directRange.periodo}.\n\n*Agenda:*\n${calendarResult}`;
    }

    // Pede à Mariah para estruturar a ação em JSON
    const raw = await callClaude(getMariahCalendarSystem(), userMessage, 600);

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
        calendarResult = await deletarEvento(eventos[0].id, eventos[0].calendarId);
      } else {
        // Mais de um resultado — pede confirmação
        const lista = eventos.map((e, i) => {
          const inicio = e.start.dateTime
            ? new Date(e.start.dateTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
            : 'dia todo';
          const origem = e.calendarName ? ` [${e.calendarName}]` : '';
          return `${i + 1}. ${e.summary} — ${inicio}${origem}`;
        }).join('\n');
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
          const origem = e.calendarName ? ` [${e.calendarName}]` : '';
          return `• ${hora} — ${e.summary}${origem}`;
        }).join('\n');
      }
    }

    // Monta resposta final
    const textoFinal = calendarResult
      ? `${resposta}\n\n*Agenda:*\n${calendarResult}`
      : resposta;

    return textoFinal;

  } catch (err) {
    console.error('[mariah] Erro ao processar agenda:', err.message);
    return null; // fallback para resposta normal da Mariah
  }
}

module.exports = { processMariahCalendar, isAgendaRequest };
