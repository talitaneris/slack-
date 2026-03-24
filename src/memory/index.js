'use strict';

/**
 * Módulo de memória persistente — backend Supabase.
 * Substitui o sistema de arquivos anterior mantendo a mesma API.
 *
 * Tabelas necessárias (ver schema em docs/supabase-schema.sql):
 *   agent_memory         — memória acumulada por agente
 *   agent_tasks          — tasks abertas por agente
 *   aprovacoes_pendentes — aprovações aguardando resposta de Talita
 */

const { createClient } = require('@supabase/supabase-js');

// Cliente Supabase — inicializado uma vez e reutilizado
let _client = null;
function getClient() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      console.warn('⚠️  SUPABASE_URL ou SUPABASE_SERVICE_KEY ausentes — memória desativada');
      return null;
    }
    _client = createClient(url, key);
  }
  return _client;
}

// ─── MEMÓRIA ─────────────────────────────────────────────────

/**
 * Lê a memória acumulada de um agente.
 * Retorna string vazia se não existir ou Supabase indisponível.
 */
async function readMemory(agentKey) {
  try {
    const sb = getClient();
    if (!sb) return '';

    const { data, error } = await sb
      .from('agent_memory')
      .select('content')
      .eq('agent_key', agentKey)
      .single();

    if (error || !data) return '';
    return data.content || '';
  } catch {
    return '';
  }
}

/**
 * Acrescenta uma entrada com timestamp BRT ao final da memória do agente.
 * Cria o registro se não existir (upsert).
 */
async function appendMemory(agentKey, entry) {
  try {
    const sb = getClient();
    if (!sb) return;

    // Timestamp BRT legível
    const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);

    const novaEntrada = `\n\n---\n[${brtNow} BRT]\n${entry}`;

    // Lê o conteúdo atual e concatena
    const atual = await readMemory(agentKey);
    const conteudoAtualizado = (atual || '') + novaEntrada;

    await sb.from('agent_memory').upsert(
      { agent_key: agentKey, content: conteudoAtualizado, updated_at: new Date().toISOString() },
      { onConflict: 'agent_key' }
    );
  } catch {
    // Falha silenciosa — nunca derruba o bot
  }
}

/**
 * Sobrescreve integralmente a memória de um agente.
 */
async function writeMemory(agentKey, content) {
  try {
    const sb = getClient();
    if (!sb) return;

    await sb.from('agent_memory').upsert(
      { agent_key: agentKey, content, updated_at: new Date().toISOString() },
      { onConflict: 'agent_key' }
    );
  } catch {
    // Falha silenciosa
  }
}

// ─── TASKS ABERTAS ───────────────────────────────────────────

/**
 * Lê as tasks abertas de um agente como texto formatado.
 */
async function readTasks(agentKey) {
  try {
    const sb = getClient();
    if (!sb) return '';

    const { data, error } = await sb
      .from('agent_tasks')
      .select('task, created_at')
      .eq('agent_key', agentKey)
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) return '';

    return data.map(r => {
      const ts = new Date(r.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      return `- [${ts}] ${r.task}`;
    }).join('\n');
  } catch {
    return '';
  }
}

/**
 * Adiciona uma task aberta para um agente.
 */
async function addTask(agentKey, task) {
  try {
    const sb = getClient();
    if (!sb) return;

    await sb.from('agent_tasks').insert({ agent_key: agentKey, task });
  } catch {
    // Falha silenciosa
  }
}

// ─── APROVAÇÕES PENDENTES ────────────────────────────────────

/**
 * Salva uma aprovação pendente identificada pelo ts da mensagem no Slack.
 */
async function saveAprovacaoPendente(messageTs, agentKey, content) {
  try {
    const sb = getClient();
    if (!sb) return;

    await sb.from('aprovacoes_pendentes').upsert(
      { message_ts: messageTs, agent_key: agentKey, content },
      { onConflict: 'message_ts' }
    );
  } catch {
    // Falha silenciosa
  }
}

/**
 * Retorna todas as aprovações pendentes como objeto { messageTs: { agentKey, content } }.
 */
async function readAprovacoesPendentes() {
  try {
    const sb = getClient();
    if (!sb) return {};

    const { data, error } = await sb
      .from('aprovacoes_pendentes')
      .select('message_ts, agent_key, content, saved_at');

    if (error || !data) return {};

    return Object.fromEntries(
      data.map(r => [r.message_ts, { agentKey: r.agent_key, content: r.content, savedAt: r.saved_at }])
    );
  } catch {
    return {};
  }
}

/**
 * Remove uma aprovação pendente pelo ts da mensagem.
 */
async function removeAprovacaoPendente(messageTs) {
  try {
    const sb = getClient();
    if (!sb) return;

    await sb.from('aprovacoes_pendentes').delete().eq('message_ts', messageTs);
  } catch {
    // Falha silenciosa
  }
}

module.exports = {
  readMemory,
  appendMemory,
  writeMemory,
  readTasks,
  addTask,
  saveAprovacaoPendente,
  readAprovacoesPendentes,
  removeAprovacaoPendente,
};
