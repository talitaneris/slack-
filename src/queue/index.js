'use strict';

/**
 * Fila inter-agente — backend Supabase.
 * Substitui o sistema de arquivos JSON anterior.
 *
 * Tabela necessária: inter_agent_queue (ver docs/supabase-schema.sql)
 */

const { createClient } = require('@supabase/supabase-js');

let _client = null;
function getClient() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) return null;
    _client = createClient(url, key);
  }
  return _client;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Adiciona uma nova tarefa à fila para um agente.
 * Retorna o ID gerado ou null em caso de erro.
 */
async function enqueue(from, to, command, payload = {}) {
  try {
    const sb = getClient();
    if (!sb) return null;

    const id  = generateId();
    const now = new Date().toISOString();

    const { error } = await sb.from('inter_agent_queue').insert({
      id,
      from_agent: from,
      to_agent:   to,
      command,
      payload,
      status:     'pending',
      created_at: now,
      updated_at: now,
      result:     null,
    });

    if (error) {
      console.error('Erro ao enfileirar task:', error.message);
      return null;
    }

    return id;
  } catch {
    return null;
  }
}

/**
 * Retorna todas as tasks com status 'pending' destinadas a um agente.
 */
async function getPendingFor(agentKey) {
  try {
    const sb = getClient();
    if (!sb) return [];

    const { data, error } = await sb
      .from('inter_agent_queue')
      .select('*')
      .eq('to_agent', agentKey)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

/**
 * Marca uma task como 'processing'.
 */
async function markProcessing(taskId) {
  try {
    const sb = getClient();
    if (!sb) return;

    await sb
      .from('inter_agent_queue')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', taskId);
  } catch {
    // Falha silenciosa
  }
}

/**
 * Marca uma task como concluída e armazena o resultado.
 */
async function complete(taskId, result) {
  try {
    const sb = getClient();
    if (!sb) return;

    await sb
      .from('inter_agent_queue')
      .update({ status: 'done', result, updated_at: new Date().toISOString() })
      .eq('id', taskId);
  } catch {
    // Falha silenciosa
  }
}

/**
 * Marca uma task como erro.
 */
async function markError(taskId, error) {
  try {
    const sb = getClient();
    if (!sb) return;

    await sb
      .from('inter_agent_queue')
      .update({ status: 'error', result: { error: String(error) }, updated_at: new Date().toISOString() })
      .eq('id', taskId);
  } catch {
    // Falha silenciosa
  }
}

/**
 * Remove tasks done/error com mais de 7 dias.
 * Retorna o número de tasks removidas.
 */
async function cleanup() {
  try {
    const sb = getClient();
    if (!sb) return 0;

    const limite = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await sb
      .from('inter_agent_queue')
      .delete()
      .in('status', ['done', 'error'])
      .lt('updated_at', limite)
      .select('id');

    if (error) return 0;
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}

module.exports = {
  enqueue,
  getPendingFor,
  markProcessing,
  complete,
  markError,
  cleanup,
};
