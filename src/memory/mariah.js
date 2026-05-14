'use strict';

const { readAllMariahMemory, readMariahMemory, writeMariahMemory } = require('./index');
const { callClaudeFast } = require('../claude');

// ─── BOOT: monta contexto de memória para o system prompt ────

function formatMariahMemoryForSystem(memories) {
  const sections = [];

  // Perfil cumulativo — vai primeiro, é o contexto mais rico
  if (memories.talita_profile?.trim())
    sections.push(`PERFIL DA TALITA (construído ao longo do tempo — use para antecipar):\n${memories.talita_profile}`);

  if (memories.decisoes?.trim())
    sections.push(`DECISÕES REGISTRADAS (nunca contradizer):\n${memories.decisoes}`);

  if (memories.pendencias?.trim())
    sections.push(`PENDÊNCIAS ABERTAS:\n${memories.pendencias}`);

  if (memories.aprendizados?.trim())
    sections.push(`APRENDIZADOS (não repetir erros):\n${memories.aprendizados}`);

  if (memories.preferencias?.trim())
    sections.push(`PREFERÊNCIAS DA TALITA:\n${memories.preferencias}`);

  if (memories.contexto_semanal?.trim())
    sections.push(`CONTEXTO SEMANAL:\n${memories.contexto_semanal}`);

  // Episódios recentes — últimos 5 dias para consciência situacional
  if (memories.episodios?.trim()) {
    const linhas = memories.episodios.trim().split('\n');
    const recentes = linhas.slice(-20).join('\n'); // últimas 20 linhas
    sections.push(`EPISÓDIOS RECENTES:\n${recentes}`);
  }

  if (sections.length === 0) return '';
  return '=== MEMÓRIA ESTRUTURADA ===\n' + sections.join('\n\n') + '\n=== FIM DA MEMÓRIA ===';
}

async function buildMariahMemoryContext() {
  try {
    const memories = await readAllMariahMemory();
    return formatMariahMemoryForSystem(memories);
  } catch {
    return '';
  }
}

// ─── REGISTRO: extrai e salva o que importa de cada conversa ─

const REGISTRO_SYSTEM = `Você é o sistema de memória da Mariah. Analise a conversa e extraia APENAS informações que valem ser lembradas permanentemente.

Retorne JSON válido (sem markdown):
{
  "decisoes": "texto ou null",
  "pendencias": "texto ou null",
  "aprendizados": "texto ou null",
  "preferencias": "texto ou null"
}

Regras:
- decisoes: só quando Talita tomou uma decisão clara que não deve ser contradita depois
- pendencias: só quando há tarefa com prazo ou dono definido
- aprendizados: só quando Talita corrigiu algo ou disse "não faça X" / "prefiro Y"
- preferencias: só fatos fixos da Talita (rotina, jeito de trabalhar, gostos)
- Se não há nada relevante numa categoria, retorne null
- Seja conciso — 1 linha por entrada no máximo`;

async function alertarContradicaoTelegram(descricao) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `Atenção: essa decisão pode contradizer uma anterior.\n\n${descricao}` }),
    });
  } catch {}
}

async function verificarContradicao(novaDecisao, decisoesExistentes) {
  if (!decisoesExistentes?.trim()) return null;
  try {
    const raw = await callClaudeFast(
      'Você verifica contradições entre decisões. Retorne JSON válido sem markdown: {"contradiz": true ou false, "descricao": "qual contradição ou null"}',
      `Nova decisão: "${novaDecisao}"\n\nDecisões anteriores:\n${decisoesExistentes.slice(0, 800)}`,
      150
    );
    const result = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    return result.contradiz ? result.descricao : null;
  } catch {
    return null;
  }
}

async function registrarNaMemoria(userText, mariahResponse) {
  try {
    const prompt = `Mensagem da Talita: "${userText.slice(0, 400)}"\n\nResposta da Mariah: "${mariahResponse.slice(0, 400)}"\n\nO que deve ser registrado na memória permanente?`;

    const raw = await callClaudeFast(REGISTRO_SYSTEM, prompt, 300);
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').slice(0, 16);

    const memories = await readAllMariahMemory();

    for (const [cat, valor] of Object.entries(parsed)) {
      if (valor && typeof valor === 'string' && valor.trim()) {
        const atual = memories[cat] || '';

        // Verifica contradição antes de salvar nova decisão
        if (cat === 'decisoes' && atual) {
          const contradicao = await verificarContradicao(valor.trim(), atual);
          if (contradicao) {
            alertarContradicaoTelegram(contradicao).catch(() => {});
          }
        }

        await writeMariahMemory(cat, (atual ? atual + '\n' : '') + `[${brtNow}] ${valor.trim()}`);
      }
    }
  } catch {
    // Falha silenciosa — nunca derruba o bot
  }
}

// ─── CONSOLIDAÇÃO DIÁRIA (toda noite 23h30) ──────────────────
// Lê o histórico do dia, extrai insights sobre a Talita e cresce o perfil

const CONSOLIDACAO_EPISODIO_SYSTEM = `Você é o sistema de memória da Mariah. Analise as conversas do dia e extraia o que é relevante para lembrar.

Retorne JSON válido (sem markdown):
{
  "episodio": "resumo do dia em 2-3 frases — o que aconteceu, o que Talita decidiu, como ela estava",
  "perfil_delta": "1-3 fatos novos aprendidos sobre Talita hoje (jeito de trabalhar, padrões, preferências, comportamentos) — ou null se nada novo",
  "pendencia_nova": "tarefa ou compromisso novo que surgiu hoje — ou null"
}

Regras:
- episodio: sempre preencha — é o diário da Mariah, cresce todo dia
- perfil_delta: só quando aprendeu algo genuinamente novo sobre a Talita, não repita o que já sabe
- pendencia_nova: só quando surgiu algo concreto com dono/prazo
- Se o histórico estiver vazio, retorne episodio: "Dia sem conversa registrada"`;

async function consolidarMemoriaDiaria() {
  try {
    // Lê histórico do canal principal (geral) — chave legada + nova
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID || '';
    const histKey = chatId ? `history_${chatId}` : 'history';
    const histRaw = await readMariahMemory(histKey);
    if (!histRaw?.trim()) {
      // Sem histórico — registra episódio mínimo
      const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').slice(0, 10);
      const episodioAtual = await readMariahMemory('episodios') || '';
      await writeMariahMemory('episodios', episodioAtual + `\n[${brtNow}] Dia sem conversa registrada`);
      return;
    }

    // Pega as últimas mensagens do dia (últimos 50 pares = 100 mensagens no máximo)
    let hist = [];
    try { hist = JSON.parse(histRaw); } catch { return; }
    const resumo = hist.slice(-50).map(m => `${m.role}: ${m.content}`).join('\n');

    const raw = await callClaudeFast(CONSOLIDACAO_EPISODIO_SYSTEM, `Conversas do dia:\n${resumo.slice(0, 3000)}`, 500);
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').slice(0, 10);

    // Cresce o diário de episódios (nunca apaga — memória infinita)
    if (parsed.episodio) {
      const episodioAtual = await readMariahMemory('episodios') || '';
      await writeMariahMemory('episodios', episodioAtual + `\n[${brtNow}] ${parsed.episodio.trim()}`);
    }

    // Cresce o perfil da Talita (só adiciona conhecimento novo)
    if (parsed.perfil_delta && typeof parsed.perfil_delta === 'string' && parsed.perfil_delta.trim()) {
      const perfilAtual = await readMariahMemory('talita_profile') || '';
      await writeMariahMemory('talita_profile', perfilAtual + `\n[${brtNow}] ${parsed.perfil_delta.trim()}`);
    }

    // Registra nova pendência se surgiu
    if (parsed.pendencia_nova && typeof parsed.pendencia_nova === 'string' && parsed.pendencia_nova.trim()) {
      const pendencias = await readMariahMemory('pendencias') || '';
      await writeMariahMemory('pendencias', pendencias + `\n[${brtNow}] ${parsed.pendencia_nova.trim()}`);
    }

    console.log('[mariah-memory] Consolidação diária concluída');
  } catch (err) {
    console.error('[mariah-memory] Erro na consolidação diária:', err.message);
  }
}

// ─── MANUTENÇÃO SEMANAL (toda segunda) ───────────────────────

const MANUTENCAO_PENDENCIAS_SYSTEM = `Você é o sistema de manutenção de memória da Mariah. É segunda-feira — hora de limpar.

Receba as pendências atuais e retorne APENAS as que ainda fazem sentido manter abertas.
Remova as que claramente já foram resolvidas ou que são antigas sem relevância.
Consolide duplicatas. Mantenha no máximo 10 pendências.
Retorne texto limpo, uma por linha, formato: "[data] descrição"
Se não há nada para manter, retorne string vazia.`;

const CONTEXTO_SEMANAL_SYSTEM = `Gere um contexto semanal resumido para a Mariah começar a semana alinhada. Máximo 120 palavras. Foque no que importa agir esta semana, sem introdução.`;

async function manutencaoSemanal() {
  try {
    const memories = await readAllMariahMemory();

    // Limpa e consolida pendências
    if (memories.pendencias?.trim()) {
      const cleaned = await callClaudeFast(MANUTENCAO_PENDENCIAS_SYSTEM, memories.pendencias, 400);
      await writeMariahMemory('pendencias', cleaned.trim());
    }

    // Gera contexto semanal consolidado
    const partes = [
      memories.decisoes ? `Decisões recentes:\n${memories.decisoes}` : '',
      memories.pendencias ? `Pendências:\n${memories.pendencias}` : '',
      memories.aprendizados ? `Aprendizados:\n${memories.aprendizados}` : '',
    ].filter(Boolean).join('\n\n');

    if (partes) {
      const contexto = await callClaudeFast(CONTEXTO_SEMANAL_SYSTEM, partes, 300);
      const semana = new Date().toLocaleDateString('pt-BR');
      await writeMariahMemory('contexto_semanal', `[Semana de ${semana}]\n${contexto.trim()}`);
    }

    console.log('[mariah-memory] Manutenção semanal concluída');
  } catch (err) {
    console.error('[mariah-memory] Erro na manutenção semanal:', err.message);
  }
}

module.exports = { buildMariahMemoryContext, registrarNaMemoria, manutencaoSemanal, consolidarMemoriaDiaria };
