'use strict';

const { enqueue, getPendingFor, cleanup } = require('../queue/index');
const { AGENTS } = require('../agents');

// IDs dos canais usados pelos webhooks
const CHANNELS = {
  vendas:   'C0AMJ13D85T',
  alertas:  'C03PY24RJJJ',
};

/**
 * Verifica o segredo do webhook no header da requisição.
 * Retorna true se válido (ou se nenhum segredo estiver configurado).
 */
function isAuthorized(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // sem segredo configurado: aceita tudo
  return req.headers['x-webhook-secret'] === secret;
}

/**
 * Registra as rotas de webhook no receiver Express do Bolt.
 */
function registerWebhooks(receiver, slackClient, logger) {

  // ── POST /webhook/lead ──
  // Recebe um novo lead e enfileira para a Lia processar
  receiver.router.post('/webhook/lead', async (req, res) => {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Não autorizado — x-webhook-secret inválido' });
      }

      const { name, contact, source, notes } = req.body || {};

      if (!name && !contact) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes: name ou contact' });
      }

      const taskId = enqueue('webhook', 'lia', 'novo_lead', { name, contact, source, notes });

      // Alerta no canal de vendas
      try {
        await slackClient.chat.postMessage({
          channel: CHANNELS.vendas,
          text: `🎯 *Novo lead recebido via webhook*\n• Nome: ${name || 'N/A'}\n• Contato: ${contact || 'N/A'}\n• Fonte: ${source || 'N/A'}\n• Obs: ${notes || '—'}\n\n_Lia foi notificada para qualificar. Task ID: ${taskId}_`,
        });
      } catch (slackErr) {
        logger.error('Erro ao postar alerta de lead no Slack:', slackErr.message);
      }

      logger.info(`Webhook lead recebido — task ${taskId} enfileirada para Lia`);
      return res.status(200).json({ ok: true, taskId, message: 'Lead enfileirado para Lia' });

    } catch (err) {
      logger.error('Erro no webhook /lead:', err);
      return res.status(500).json({ error: 'Erro interno ao processar lead' });
    }
  });

  // ── POST /webhook/metrics ──
  // Recebe métricas e enfileira para a Lens analisar
  receiver.router.post('/webhook/metrics', async (req, res) => {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Não autorizado — x-webhook-secret inválido' });
      }

      const payload = req.body || {};
      const taskId  = enqueue('webhook', 'lens', 'analisar_metricas', payload);

      // Alerta no canal de alertas
      try {
        await slackClient.chat.postMessage({
          channel: CHANNELS.alertas,
          text: `📊 *Métricas recebidas via webhook*\nLens vai analisar os dados enviados.\n_Task ID: ${taskId}_`,
        });
      } catch (slackErr) {
        logger.error('Erro ao postar alerta de métricas no Slack:', slackErr.message);
      }

      logger.info(`Webhook metrics recebido — task ${taskId} enfileirada para Lens`);
      return res.status(200).json({ ok: true, taskId, message: 'Métricas enfileiradas para Lens' });

    } catch (err) {
      logger.error('Erro no webhook /metrics:', err);
      return res.status(500).json({ error: 'Erro interno ao processar métricas' });
    }
  });

  // ── POST /webhook/trigger/:agent ──
  // Trigger genérico para qualquer agente do squad
  receiver.router.post('/webhook/trigger/:agent', async (req, res) => {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Não autorizado — x-webhook-secret inválido' });
      }

      const agentParam = req.params.agent;
      const { command, payload } = req.body || {};

      // Valida se o agente existe no squad
      const agentExists = Object.values(AGENTS).some(
        a => a.key === agentParam || a.key === agentParam.toLowerCase()
      );

      if (!agentExists) {
        return res.status(404).json({
          error: `Agente '${agentParam}' não encontrado`,
          agentesDisponiveis: Object.values(AGENTS).map(a => a.key),
        });
      }

      if (!command) {
        return res.status(400).json({ error: 'Campo obrigatório ausente: command' });
      }

      const taskId = enqueue('webhook', agentParam, command, payload || {});

      logger.info(`Webhook trigger — agente: ${agentParam}, comando: ${command}, task: ${taskId}`);
      return res.status(200).json({
        ok: true,
        taskId,
        message: `Comando '${command}' enfileirado para agente '${agentParam}'`,
      });

    } catch (err) {
      logger.error('Erro no webhook /trigger:', err);
      return res.status(500).json({ error: 'Erro interno ao processar trigger' });
    }
  });

  // ── GET /webhook/queue/status ──
  // Retorna resumo do estado atual da fila inter-agente
  receiver.router.get('/webhook/queue/status', async (req, res) => {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Não autorizado — x-webhook-secret inválido' });
      }

      // Monta contagem de tarefas pendentes por agente
      const agentes = Object.values(AGENTS).map(a => a.key);
      const porAgente = {};

      for (const key of agentes) {
        const pendentes = getPendingFor(key);
        if (pendentes.length > 0) {
          porAgente[key] = pendentes.length;
        }
      }

      return res.status(200).json({
        ok: true,
        timestamp: new Date().toISOString(),
        pendentes: porAgente,
        totalPendentes: Object.values(porAgente).reduce((a, b) => a + b, 0),
      });

    } catch (err) {
      logger.error('Erro no webhook /queue/status:', err);
      return res.status(500).json({ error: 'Erro interno ao ler status da fila' });
    }
  });

  logger.info('Webhooks registrados: /webhook/lead | /webhook/metrics | /webhook/trigger/:agent | /webhook/queue/status');
}

module.exports = { registerWebhooks };
