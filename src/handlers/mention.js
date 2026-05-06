const { detectAgent, AGENTS } = require('../agents');
const { callClaude, callClaudeWithHistory } = require('../claude');
const { fetchBrandKit } = require('../notion');
const { readMemory, appendMemory, saveAprovacaoPendente } = require('../memory/index');
const { getPendingFor } = require('../queue/index');
const { processMariahCalendar } = require('./mariah');
const { getPrivateContextForAgent } = require('../privateContext');

const APROVACOES_CHANNEL = 'C061GRE0LUA';

const HELP_TEXT = [
  '*Squad TNeris — Agentes disponíveis:*',
  '',
  '*Nara* — Operações, dados, acessos, bases, prazos e fluxo entre agentes',
  '*Jay* — Receita, pipeline, estratégia comercial',
  '*Sofia* — MRR, pagamentos, inadimplência',
  '*Mari* — Customer Success, saúde das mentoradas',
  '*Lia* — Qualificação de leads, vendas, fechamento',
  '*Marta* — Funil, score de leads, pipeline',
  '*Vega* — Posicionamento de marca, comunicação',
  '*People* — Conteúdo, roteiros, calendário editorial',
  '*Cleo* — Copy sênior: páginas de venda, VSL, email, headlines, scripts',
  '*Alex* — Design no Canva, peças visuais, landing pages, web design',
  '*Paulo* — Material instrucional, aulas da mentoria',
  '*Lens* — Métricas, dados, Instagram e TikTok',
  '*Mariah* — Agenda pessoal, pagamentos, reuniões, delegações',
  '',
  'Como usar: `@Squad TNeris Bot Jay, qual é o status do pipeline?`',
].join('\n');

const VEGA_REVIEW_SYSTEM = `Você é Vega, Estrategista de Marca do Squad TNeris. Sua função aqui é revisar conteúdo criado pela People antes de ir para aprovação final da Talita.

Avalie o conteúdo com base em:
1. Alinhamento com o posicionamento da Talita (leitura antropológica de negócios)
2. Voz da marca — sem linguagem genérica, inflada ou clichê
3. Abertura forte — sem frases genéricas
4. Intenção clara — o conteúdo tem propósito definido?
5. Coerência com a tese central: "Crescimento é extrair o que já existe"

Responda APENAS com um destes formatos:

Se aprovado:
✅ *Vega aprovou*
[1-2 linhas explicando por que está alinhado com a marca]

Se precisa ajuste:
🔄 *Vega sugere ajuste*
[Diga especificamente o que ajustar e por quê — máximo 3 linhas]
[Entregue a versão corrigida]`;

/**
 * Instrução universal de execução imediata — preposta a todo system prompt.
 * Resolve Bug 3 e Bug 4: agentes perguntavam quando tinham contexto suficiente.
 */
const EXECUTION_RULE = `
REGRA DE EXECUÇÃO IMEDIATA:
Antes de fazer qualquer pergunta, verifique todo o histórico da conversa.
Se o contexto necessário já foi fornecido (material, agenda, texto, dados), EXECUTE IMEDIATAMENTE.
Só faça perguntas quando uma informação crítica estiver genuinamente ausente e impossível de inferir.
Nunca peça informações que já aparecem na conversa atual.
Quando o usuário disser "não gostei, quero X" e já tiver colado o material: use o material e entregue.
`;

const OPERATIONAL_MEMORY_RULE = `
PROTOCOLO DE MEMÓRIA OPERACIONAL:
Você não é um chat solto. Você é um agente do Squad TNeris com função, território e memória.

Toda informação importante enviada por Talita precisa virar uma destas coisas:
- memória
- tarefa
- decisão
- número
- regra
- alerta
- próxima ação

Quando Talita corrigir você, não peça desculpa demais. Registre a regra e mude o comportamento.
Formato obrigatório:
Entendi.
Erro: [o que fiz errado].
Regra registrada: [nova regra].
Daqui para frente: [como vou agir].
Próxima entrega: [o que farei agora].

Antes de responder, cheque:
- consultei a memória acumulada?
- considerei a realidade atual da TNeris?
- estou economizando tempo da Talita ou consumindo mais?
- trouxe decisão, ação, prazo ou responsável?
- estou bajulando ou sendo útil?

Postura obrigatória:
- não bajular
- não concordar por educação
- questionar quando a ideia estiver sofisticada demais para a fase atual
- proteger o básico bem feito antes de propor complexidade
- falar a verdade com clareza e sem grosseria

Realidade operacional atual:
- TNeris ainda é uma operação pequena e precisa de básico bem feito
- Jay deve proteger oferta clara, venda, follow-up, calendário comercial e caixa
- Jay precisa trazer solução e delegar coleta/execução para os agentes; não pode devolver mais trabalho para Talita
- Sofia deve registrar dado financeiro; informação financeira no Slack não é conversa, é dado
- Vega, People e Alex devem evitar texto perfeito demais, linguagem com cara de IA e fórmulas prontas
`;

const SLACK_FORMAT_RULE = `
FORMATAÇÃO OBRIGATÓRIA NO SLACK:
- Responda curto. Mensagem comum: até 90 palavras. Estratégia/diagnóstico: até 140 palavras.
- Não use cabeçalho grande, título em caixa alta, markdown de título (#/##), linha divisória ou tabela.
- Use no máximo 3 bullets.
- Emoji: no máximo 1 na mensagem inteira. Se não fizer falta, não use.
- Se a resposta precisar ser longa, entregue só a decisão e diga que pode detalhar depois.
- Formato preferido: leitura → verdade direta → ação.
- Não pareça relatório. Pareça um diretor falando com Talita no Slack.
- Para negrito no Slack, use apenas *uma estrela*. Nunca use **duas estrelas**.
`;

function getRuntimeContext() {
  const now = new Date();
  const brt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);

  return `
CONTEXTO DE DATA/HORA:
Agora em America/Sao_Paulo: ${brt}.
Use esta data como referência absoluta. Ignore datas antigas em exemplos, memória, rotinas antigas ou templates.
Se precisar mencionar data, confira por este contexto antes de responder.
`;
}

function formatForSlack(text = '') {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '*$1*')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeMemoryForPrompt(agentKey, memory) {
  if (!memory) return '';

  let sanitized = memory;

  if (agentKey === 'jay') {
    sanitized = sanitized
      .replace(/30 de março de 2026/gi, '[data antiga removida]')
      .replace(/14 mentoradas/gi, '[número antigo removido]')
      .replace(/MRR estimado[^\\n]*/gi, '[MRR antigo removido]')
      .replace(/~R\\$ 8\\.200/gi, '[valor antigo removido]')
      .replace(/zero leads novos em março/gi, '[dado antigo removido]')
      .replace(/D150/gi, '[marco antigo a confirmar]')
      .replace(/capital oculto/gi, 'extração do que já existe');
  }

  return sanitized;
}

/**
 * Busca o histórico de um thread para contexto.
 * Retorna array de { role, content } excluindo a mensagem atual.
 */
async function fetchThreadHistory(client, channel, threadTs) {
  try {
    const result = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 20,
    });
    return formatMessages((result.messages || []).slice(0, -1));
  } catch {
    return [];
  }
}

/**
 * Busca as últimas mensagens do canal quando não há thread.
 * Resolve Bug 1: usuária manda material e depois menciona o agente numa msg separada.
 */
async function fetchChannelContext(client, channel, currentTs) {
  try {
    const result = await client.conversations.history({
      channel,
      latest: currentTs,
      limit: 6,
      inclusive: false,
    });
    // Retorna em ordem cronológica (a API devolve do mais novo para o mais antigo)
    return formatMessages((result.messages || []).reverse());
  } catch {
    return [];
  }
}

/**
 * Normaliza um array de mensagens do Slack para { role, content }.
 */
function formatMessages(msgs) {
  return msgs
    .map(msg => ({
      role:    msg.bot_id ? 'assistant' : 'user',
      content: (msg.text || '').replace(/<@[A-Z0-9]+>/g, '').trim(),
    }))
    .filter(m => m.content.length > 0);
}

/**
 * Handler para eventos app_mention.
 * Identifica o agente, chama o Claude e posta a resposta no thread.
 * Para People: Vega revisa automaticamente antes de enviar para #aprovacoes.
 */
async function handleMention({ event, client, logger }) {
  const rawText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!rawText || rawText.length < 2) {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: HELP_TEXT,
    });
    return;
  }

  const agent = detectAgent(rawText);

  if (!agent) {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: `Não reconheci nenhum agente. Mencione pelo nome:\n${HELP_TEXT}`,
    });
    return;
  }

  // Posta mensagem de "processando"
  let thinkingTs;
  try {
    const thinking = await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: `${agent.icon} _${agent.title} está pensando..._`,
    });
    thinkingTs = thinking.ts;
  } catch (err) {
    logger.error('Erro ao postar mensagem de espera:', err);
    return;
  }

  try {
    // Alex busca o brand kit atualizado do Notion antes de responder
    let systemPrompt = agent.system;
    if (agent.key === 'alex') {
      const brandKit = await fetchBrandKit();
      if (brandKit) {
        systemPrompt = `${agent.system}\n\nBRAND KIT ATUALIZADO DO NOTION:\n${brandKit}`;
      }
    }

    // Injeta regra de execução imediata em todos os agentes (Fix Bug 3 e 4)
    systemPrompt = getRuntimeContext() + EXECUTION_RULE + OPERATIONAL_MEMORY_RULE + SLACK_FORMAT_RULE + systemPrompt;

    // Lê a memória acumulada do agente e acrescenta ao system prompt.
    // Memória é histórico de interação, não fonte factual. O contexto privado entra depois e vence conflito.
    try {
      const memoriaAgente = await readMemory(agent.key);
      if (memoriaAgente && memoriaAgente.trim().length > 0) {
        const memoriaSanitizada = sanitizeMemoryForPrompt(agent.key, memoriaAgente).slice(-4500);
        systemPrompt = `${systemPrompt}\n\nMEMÓRIA DE INTERAÇÕES DO AGENTE:\nUse apenas para preferências, correções e continuidade. Não use como fonte factual se conflitar com o contexto privado.\n${memoriaSanitizada}`;
      }
    } catch {
      // Falha de memória não interrompe o fluxo
    }

    // Injeta contexto privado versionado por agente, quando configurado no Render.
    // Este bloco entra depois da memória para vencer qualquer informação antiga acumulada.
    try {
      const privateContext = await getPrivateContextForAgent(agent.key);
      if (privateContext && privateContext.trim().length > 0) {
        systemPrompt = `${systemPrompt}\n\n${privateContext}`;
      }
    } catch (err) {
      logger.warn?.(`Contexto privado indisponível para ${agent.key}: ${err.message}`);
    }

    // Monta histórico de contexto — thread ou canal (Fix Bug 1)
    let historico = [];
    if (event.thread_ts) {
      historico = await fetchThreadHistory(client, event.channel, event.thread_ts);
    } else {
      historico = await fetchChannelContext(client, event.channel, event.ts);
    }

    // Chama o Claude com ou sem histórico
    let response;
    if (historico.length > 0) {
      // Injeta o contexto diretamente na mensagem para garantir que o agente use
      const contextoTexto = historico
        .map(m => `[${m.role === 'user' ? 'Talita' : 'Agente'}]: ${m.content}`)
        .join('\n\n');
      const mensagemComContexto = `CONTEXTO JÁ FORNECIDO NA CONVERSA:\n${contextoTexto}\n\n---\nDEMANDA ATUAL: ${rawText}\n\nIMPORTANTE: Use o contexto acima. NÃO peça informações que já estão ali.`;
      response = await callClaude(systemPrompt, mensagemComContexto);
    } else {
      response = await callClaude(systemPrompt, rawText);
    }

    // Verifica tarefas pendentes na fila para o agente
    try {
      const tarefasPendentes = await getPendingFor(agent.key);
      if (tarefasPendentes.length > 0) {
        response = `${response}\n\n📋 _${tarefasPendentes.length} tarefa(s) pendente(s) na fila para ${agent.title}._`;
      }
    } catch (queueErr) {
      // Falha de fila não interrompe o fluxo
    }

    // Fluxo especial para Mariah: verifica se é pedido de agenda e executa no Google Calendar
    if (agent.key === 'assistente') {
      const calendarResponse = await processMariahCalendar(rawText, systemPrompt);
      if (calendarResponse) response = calendarResponse;
    }

    response = formatForSlack(response);

    // Grava memória após a resposta — fire and forget (não bloqueia o bot)
    appendMemory(
      agent.key,
      [
        `Fonte: Slack`,
        `Tipo: interação com Talita`,
        `Pergunta/Demanda: ${rawText.slice(0, 500)}`,
        `Resposta entregue: ${response.slice(0, 700)}`,
        `Regra: se houver correção da Talita nesta interação, transformar em regra operacional na próxima resposta.`,
      ].join('\n')
    ).catch(() => {});

    const agentHeader = `${agent.icon} *${agent.title}* — ${agent.role}`;

    // Fix Bug 2: Vega mencionado diretamente não dispara auto-revisão do People.
    // Auto-revisão só ocorre quando @people é quem gerou o conteúdo.
    const vegaFoiMencionadoDiretamente = agent.key === 'vega';

    // Fluxo especial para People: revisão do Vega antes de ir para #aprovacoes
    // (não executa se Vega foi chamado diretamente)
    if (agent.key === 'people' && !vegaFoiMencionadoDiretamente) {
      // 1. Mostra o conteúdo da People no thread
      await client.chat.update({
        channel: event.channel,
        ts: thinkingTs,
        text: `${agentHeader}\n\n${response}`,
      });

      // 2. Vega revisa automaticamente
      const vegaThinking = await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: `⭐ _Vega revisando..._`,
      });

      const vegaReview = formatForSlack(await callClaude(VEGA_REVIEW_SYSTEM, response));
      const vegaApproved = vegaReview.includes('Vega aprovou');

      await client.chat.update({
        channel: event.channel,
        ts: vegaThinking.ts,
        text: `⭐ *Vega* — Estrategista de Marca\n\n${vegaReview}`,
      });

      // 3. Se Vega aprovou, envia para #aprovacoes e registra aprovação pendente
      if (vegaApproved) {
        const approvalMessage = await client.chat.postMessage({
          channel: APROVACOES_CHANNEL,
          text: `✍️ *People* — Conteúdo para aprovação\n\n${response}\n\n---\n⭐ *Vega aprovou* — aguardando aprovação final de Talita.\n→ Responda APROVADO para confirmar ou REVISAR [feedback] para ajustar`,
        });

        // Salva a aprovação pendente para o handler de aprovações processar
        saveAprovacaoPendente(approvalMessage.ts, 'people', response).catch(() => {});

        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: event.thread_ts || event.ts,
          text: `📬 Conteúdo enviado para *#aprovacoes* — aguardando sua aprovação final, Talita.`,
        });
      }

    } else {
      // Fluxo normal para todos os outros agentes
      await client.chat.update({
        channel: event.channel,
        ts: thinkingTs,
        text: `${agentHeader}\n\n${response}`,
      });
    }

  } catch (err) {
    logger.error(`Erro ao chamar Claude para agente ${agent.title}:`, err);
    await client.chat.update({
      channel: event.channel,
      ts: thinkingTs,
      text: `❌ *${agent.title}* encontrou um erro. Tente novamente em alguns instantes.`,
    });
  }
}

module.exports = { handleMention };
