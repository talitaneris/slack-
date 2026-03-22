const { detectAgent } = require('../agents');
const { callClaude } = require('../claude');

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
  '🤝 *Assistente* — Agenda, reuniões, delegações',
  '',
  'Como usar: `@Squad TNeris Bot Jay, qual é o status do pipeline?`',
].join('\n');

/**
 * Handler para eventos app_mention.
 * Identifica o agente, chama o Claude e posta a resposta no thread.
 */
async function handleMention({ event, client, logger }) {
  // Remove a menção do bot do texto (ex: "<@U12345> Jay, ...")
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

  // Posta mensagem de "processando" enquanto chama o Claude
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
    const response = await callClaude(agent.system, rawText);

    await client.chat.update({
      channel: event.channel,
      ts: thinkingTs,
      text: `${agent.icon} *${agent.title}* — ${agent.role}\n\n${response}`,
    });
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
