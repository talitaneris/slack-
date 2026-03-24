'use strict';

const {
  readAprovacoesPendentes,
  removeAprovacaoPendente,
  appendMemory,
} = require('../memory/index');
const { callClaude } = require('../claude');
const { AGENTS }     = require('../agents');

// Canal de aprovações — apenas mensagens desse canal são processadas
const APROVACOES_CHANNEL = 'C061GRE0LUA';

/**
 * Registra o handler de aprovações no app do Bolt.
 * Escuta mensagens no canal #aprovacoes e processa respostas de APROVADO / REVISAR.
 */
function registerApprovalHandler(app) {
  app.message(async ({ message, client, logger }) => {
    try {
      // Ignora mensagens fora do canal de aprovações
      if (message.channel !== APROVACOES_CHANNEL) return;

      // Ignora mensagens de bots
      if (message.bot_id) return;

      // Processa apenas respostas em thread (não a mensagem original)
      if (!message.thread_ts || message.thread_ts === message.ts) return;

      const texto = (message.text || '').trim();
      const textoUpper = texto.toUpperCase();

      // Verifica se a resposta começa com APROVADO ou REVISAR
      const isAprovado = textoUpper.startsWith('APROVADO');
      const isRevisar  = textoUpper.startsWith('REVISAR');

      if (!isAprovado && !isRevisar) return;

      // Busca a aprovação pendente pelo ts do thread original
      const pendentes = readAprovacoesPendentes();
      const pendente  = pendentes[message.thread_ts];

      if (!pendente) {
        // Aprovação não encontrada — ignora silenciosamente
        return;
      }

      const { agentKey, content } = pendente;

      if (isAprovado) {
        // ── Fluxo de aprovação ──
        appendMemory(agentKey, `APROVADO: ${content.slice(0, 500)}`);

        await client.chat.postMessage({
          channel: APROVACOES_CHANNEL,
          thread_ts: message.thread_ts,
          text: `✅ *Aprovação registrada!* O conteúdo foi salvo na memória de ${agentKey}.`,
        });

        logger.info(`Aprovação confirmada — agente: ${agentKey}, thread: ${message.thread_ts}`);
        removeAprovacaoPendente(message.thread_ts);

      } else if (isRevisar) {
        // ── Fluxo de revisão ──
        // Extrai o feedback após "REVISAR " (ou apenas "REVISAR")
        const feedback = texto.length > 8 ? texto.slice(texto.indexOf(' ') + 1).trim() : '';

        if (agentKey === 'people') {
          // Para People: reescreve o conteúdo com o feedback usando Claude
          const agent = AGENTS.people || AGENTS.assistente;
          const systemPrompt = agent ? agent.system : 'Você é um agente de conteúdo.';

          const promptRevisao = `Reescreva o seguinte conteúdo aplicando este feedback:\n\nFEEDBACK: ${feedback}\n\nCONTEÚDO ORIGINAL:\n${content}`;

          let conteudoRevisado;
          try {
            conteudoRevisado = await callClaude(systemPrompt, promptRevisao, 800);
          } catch (err) {
            logger.error('Erro ao chamar Claude para revisão:', err);
            conteudoRevisado = content; // fallback: conteúdo original
          }

          await client.chat.postMessage({
            channel: APROVACOES_CHANNEL,
            thread_ts: message.thread_ts,
            text: `✍️ *People* — Conteúdo revisado\n\n${conteudoRevisado}\n\n---\n→ Responda APROVADO para confirmar`,
          });

          logger.info(`Revisão postada para People — thread: ${message.thread_ts}`);

          // Atualiza o conteúdo pendente com a versão revisada
          const { saveAprovacaoPendente } = require('../memory/index');
          saveAprovacaoPendente(message.thread_ts, agentKey, conteudoRevisado);

        } else {
          // Para outros agentes: confirmação genérica
          await client.chat.postMessage({
            channel: APROVACOES_CHANNEL,
            thread_ts: message.thread_ts,
            text: `🔄 *Revisão solicitada para ${agentKey}*\n\nFeedback registrado: ${feedback || '(sem feedback textual)'}\n\nO agente será notificado na próxima interação.`,
          });

          appendMemory(agentKey, `REVISÃO SOLICITADA: ${feedback}`);
          removeAprovacaoPendente(message.thread_ts);
        }
      }

    } catch (err) {
      // Nunca deixa o handler de aprovação derrubar o bot principal
      logger.error('Erro no handler de aprovações:', err);
    }
  });
}

module.exports = { registerApprovalHandler };
