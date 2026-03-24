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
 * Busca o histórico do thread para enviar como contexto ao Claude.
 * Retorna array de { role, content } excluindo a mensagem atual (última).
 */
async function fetchThreadHistory(client, channel, threadTs, botUserId) {
  try {
    const result = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 20,
    });

    const messages = result.messages || [];

    // Remove a última mensagem (é a atual, que já vai como userMessage)
    const historico = messages.slice(0, -1);

    return historico.map(msg => {
      // Limpa menções ao bot do texto
      const textoLimpo = (msg.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
      return {
        role:    msg.bot_id ? 'assistant' : 'user',
        content: textoLimpo,
      };
    }).filter(m => m.content.length > 0); // remove mensagens vazias após limpeza

  } catch (err) {
    // Falha silenciosa — retorna histórico vazio, o bot continua funcionando
    return [];
  }
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

    // Lê a memória acumulada do agente e acrescenta ao system prompt
    try {
      const memoriaAgente = await readMemory(agent.key);
      if (memoriaAgente && memoriaAgente.trim().length > 0) {
        systemPrompt = `${systemPrompt}\n\nMEMÓRIA ACUMULADA:\n${memoriaAgente.slice(-2000)}`;
      }
    } catch (memErr) {
      // Falha de memória não interrompe o fluxo
    }

    // Decide como chamar o Claude: com histórico de thread ou mensagem simples
    let response;
    if (event.thread_ts) {
      // É uma resposta em thread — busca o histórico para contexto
      const botUserId  = event.authorizations?.[0]?.user_id || '';
      const historico  = await fetchThreadHistory(client, event.channel, event.thread_ts, botUserId);

      if (historico.length > 0) {
        // Acrescenta a mensagem atual ao final do histórico
        const messages = [...historico, { role: 'user', content: rawText }];
        response = await callClaudeWithHistory(systemPrompt, messages);
      } else {
        // Sem histórico recuperável: chamada simples
        response = await callClaude(systemPrompt, rawText);
      }
    } else {
      // Mensagem direta (não é thread): chamada simples
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

    // Fluxo especial para People: revisão do Vega antes de ir para #aprovacoes
    if (agent.key === 'people') {
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
