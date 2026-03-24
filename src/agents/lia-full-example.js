/**
 * EXEMPLO COMPLETO: Agente Lia usando toda a infraestrutura
 *
 * Este arquivo NÃO é importado pelo sistema.
 * É uma referência de como implementar um agente com:
 * - Memória persistente
 * - Fila inter-agente
 * - Aprovação no #aprovacoes
 * - Webhook de entrada de leads
 */

'use strict';

// Importações de infraestrutura — seguir esses caminhos relativos
const { readMemory, appendMemory, saveAprovacaoPendente } = require('../memory/index');
const { getPendingFor, markProcessing, complete, markError } = require('../queue/index');
const { callClaude }  = require('../claude');
const { AGENTS }      = require('../agents');

// Canais onde Lia atua
const CANAIS = {
  vendas:     'C0AMJ13D85T',
  aprovacoes: 'C061GRE0LUA',
};

/**
 * Função principal de execução da Lia.
 * Chamada pelo processador de fila ou diretamente por um cron/webhook.
 *
 * @param {string} comando   - Comando a executar: 'novo_lead' | 'qualificar'
 * @param {object} payload   - Dados do lead ou contexto da tarefa
 * @param {object} slackClient - Cliente do Slack (app.client do Bolt)
 */
async function executarLia(comando, payload, slackClient) {

  // ── 1. Lê a memória acumulada da Lia ──
  // A memória contém decisões, padrões observados e histórico de qualificações
  const memoria = readMemory('lia');
  const contextoMemoria = memoria
    ? `\n\nMEMÓRIA ACUMULADA DA LIA:\n${memoria.slice(-2000)}`
    : '';

  // ── 2. Verifica tarefas pendentes na fila para a Lia ──
  const tarefasPendentes = getPendingFor('lia');
  const resumoFila = tarefasPendentes.length > 0
    ? `\n\nTAREFAS PENDENTES NA FILA: ${tarefasPendentes.length} item(s) aguardando.`
    : '';

  // ── 3. Monta o system prompt base da Lia com memória ──
  const agenteLia   = AGENTS.lia;
  const systemBase  = agenteLia
    ? `${agenteLia.system}${contextoMemoria}${resumoFila}`
    : `Você é Lia, especialista em vendas do Squad TNeris.${contextoMemoria}`;

  // ── Fluxo: novo_lead ──
  // Recebe dados brutos de um lead e gera briefing de qualificação Sandler
  if (comando === 'novo_lead') {
    const { name, contact, source, notes, taskId } = payload;

    // Marca a tarefa como em processamento antes de chamar o Claude
    if (taskId) markProcessing(taskId);

    const promptQualificacao = `
Novo lead recebido:
- Nome: ${name || 'N/A'}
- Contato: ${contact || 'N/A'}
- Fonte: ${source || 'N/A'}
- Observações: ${notes || 'N/A'}

Com base no método Sandler, gere um briefing de qualificação com:
1. Hipótese de dor principal (com base na fonte e observações)
2. Perguntas de qualificação para a primeira abordagem (máx 3)
3. Tom recomendado para o primeiro contato
4. Próximo passo sugerido
Máximo 200 palavras.
`.trim();

    try {
      const resposta = await callClaude(systemBase, promptQualificacao, 500);

      // Posta o briefing no canal de vendas
      await slackClient.chat.postMessage({
        channel: CANAIS.vendas,
        text: `🎯 *Lia — Briefing de Lead*\n\n*Lead:* ${name || 'N/A'} (${source || 'N/A'})\n\n${resposta}`,
      });

      // Registra na memória o lead recebido
      appendMemory('lia', `Lead qualificado: ${name} (${source}) — ${new Date().toISOString()}`);

      // Marca a tarefa como concluída na fila
      if (taskId) complete(taskId, { briefing: resposta });

    } catch (err) {
      if (taskId) markError(taskId, err.message);
      console.error('Lia — erro ao processar novo_lead:', err.message);
    }
  }

  // ── Fluxo: qualificar ──
  // Qualificação aprofundada que precisa da aprovação de Talita antes de avançar
  else if (comando === 'qualificar') {
    const { leadData, taskId } = payload;

    if (taskId) markProcessing(taskId);

    const promptAprofundado = `
Realize a qualificação aprofundada deste lead usando Sandler:
${JSON.stringify(leadData, null, 2)}

Gere uma proposta de abordagem completa com:
1. Diagnóstico de dor e urgência
2. Avaliação de budget e autoridade de decisão
3. Mensagem de proposta de valor personalizada
4. Recomendação: AVANÇAR para proposta / NUTRIR mais / DESQUALIFICAR
Máximo 250 palavras.
`.trim();

    try {
      const resposta = await callClaude(systemBase, promptAprofundado, 600);

      // Posta no #aprovacoes para Talita revisar antes de enviar ao lead
      const mensagemAprovacao = await slackClient.chat.postMessage({
        channel: CANAIS.aprovacoes,
        text: `🎯 *Lia — Qualificação para aprovação*\n\nLead: ${leadData?.name || 'N/A'}\n\n${resposta}\n\n---\n→ Responda APROVADO para enviar ao lead ou REVISAR [feedback] para ajustar`,
      });

      // Salva como aprovação pendente — aguarda resposta de Talita no thread
      saveAprovacaoPendente(mensagemAprovacao.ts, 'lia', resposta);

      appendMemory('lia', `Qualificação enviada para aprovação: ${leadData?.name} — ts: ${mensagemAprovacao.ts}`);

      if (taskId) complete(taskId, { status: 'aguardando_aprovacao', ts: mensagemAprovacao.ts });

    } catch (err) {
      if (taskId) markError(taskId, err.message);
      console.error('Lia — erro ao processar qualificar:', err.message);
    }
  }
}

module.exports = { executarLia };
