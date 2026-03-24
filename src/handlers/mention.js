const { detectAgent, AGENTS } = require('../agents');
const { callClaude, callClaudeWithHistory } = require('../claude');
const { fetchBrandKit } = require('../notion');
const { readMemory, appendMemory, saveAprovacaoPendente } = require('../memory/index');
const { getPendingFor } = require('../queue/index');

const APROVACOES_CHANNEL = 'C061GRE0LUA';

const HELP_TEXT = [
  '*Squad TNeris — Agentes disponíveis:*',
  '',
  '🌙 *Lua* — Operações, prioridades, status do squad',
  '📊 *Jay* — Receita, pipeline, estratégia comercial',
  '💰 *Sofia* — MRR, pagamentos, inadimplência',
  '🌿 *Mari* — Customer Success, saúde das mentoradas',
  '🎯 *Lia* — Qualificação de leads, vendas, fechamento',
  '📋 *Marta* — Funil, score de leads, pipeline',
  '⭐ *Vega* — Posicionamento de marca, comunicação',
  '✍️ *People* — Conteúdo, roteiros, calendário editorial',
  '🖊️ *Cleo* — Copy sênior: páginas de venda, VSL, email, headlines, scripts',
  '🎨 *Alex* — Design no Canva, peças visuais, landing pages, web design',
  '📐 *Paulo* — Material instrucional, aulas da mentoria',
  '📈 *Lens* — Métricas, dados, Instagram e TikTok',
  '🤝 *Mariah* — Agenda pessoal, pagamentos, reuniões, delegações',
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
    systemPrompt = EXECUTION_RULE + systemPrompt;

    // Lê a memória acumulada do agente e acrescenta ao system prompt
    try {
      const memoriaAgente = await readMemory(agent.key);
      if (memoriaAgente && memoriaAgente.trim().length > 0) {
        systemPrompt = `${systemPrompt}\n\nMEMÓRIA ACUMULADA:\n${memoriaAgente.slice(-2000)}`;
      }
    } catch {
      // Falha de memória não interrompe o fluxo
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

    // Grava memória após a resposta — fire and forget (não bloqueia o bot)
    appendMemory(
      agent.key,
      `PERGUNTA: ${rawText.slice(0, 300)}\nRESPOSTA: ${response.slice(0, 500)}`
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

      const vegaReview = await callClaude(VEGA_REVIEW_SYSTEM, response);
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
