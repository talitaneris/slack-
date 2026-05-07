'use strict';

const { readAllMariahMemory, writeMariahMemory } = require('./index');
const { callClaude } = require('../claude');

// ─── BOOT: monta contexto de memória para o system prompt ────

function formatMariahMemoryForSystem(memories) {
  const sections = [];

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

async function registrarNaMemoria(userText, mariahResponse) {
  try {
    const prompt = `Mensagem da Talita: "${userText.slice(0, 400)}"\n\nResposta da Mariah: "${mariahResponse.slice(0, 400)}"\n\nO que deve ser registrado na memória permanente?`;

    const raw = await callClaude(REGISTRO_SYSTEM, prompt, 200);
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').slice(0, 16);

    const memories = await readAllMariahMemory();

    for (const [cat, valor] of Object.entries(parsed)) {
      if (valor && typeof valor === 'string' && valor.trim()) {
        const atual = memories[cat] || '';
        await writeMariahMemory(cat, (atual ? atual + '\n' : '') + `[${brtNow}] ${valor.trim()}`);
      }
    }
  } catch {
    // Falha silenciosa — nunca derruba o bot
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
      const cleaned = await callClaude(MANUTENCAO_PENDENCIAS_SYSTEM, memories.pendencias, 300);
      await writeMariahMemory('pendencias', cleaned.trim());
    }

    // Gera contexto semanal consolidado
    const partes = [
      memories.decisoes ? `Decisões recentes:\n${memories.decisoes}` : '',
      memories.pendencias ? `Pendências:\n${memories.pendencias}` : '',
      memories.aprendizados ? `Aprendizados:\n${memories.aprendizados}` : '',
    ].filter(Boolean).join('\n\n');

    if (partes) {
      const contexto = await callClaude(CONTEXTO_SEMANAL_SYSTEM, partes, 200);
      const semana = new Date().toLocaleDateString('pt-BR');
      await writeMariahMemory('contexto_semanal', `[Semana de ${semana}]\n${contexto.trim()}`);
    }

    console.log('[mariah-memory] Manutenção semanal concluída');
  } catch (err) {
    console.error('[mariah-memory] Erro na manutenção semanal:', err.message);
  }
}

module.exports = { buildMariahMemoryContext, registrarNaMemoria, manutencaoSemanal };
