const { detectAgent, AGENTS } = require('../agents');
const { callClaude } = require('../claude');
const { fetchBrandKit } = require('../notion');

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
  '🎨 *Alex* — Design no Canva, peças visuais',
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

    const response = await callClaude(systemPrompt, rawText);
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

      // 3. Se Vega aprovou, envia para #aprovacoes
      if (vegaApproved) {
        await client.chat.postMessage({
          channel: APROVACOES_CHANNEL,
          text: `✍️ *People* — Conteúdo para aprovação\n\n${response}\n\n---\n⭐ *Vega aprovou* — aguardando aprovação final de Talita.`,
        });

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
