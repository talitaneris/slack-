'use strict';

const { readMemory, writeMemory } = require('./index');

/**
 * Templates iniciais de memória para cada agente.
 * São usados apenas para inicializar o arquivo na primeira execução.
 * O conteúdo real é acumulado automaticamente pelo sistema.
 */
const AGENT_MEMORY_TEMPLATES = {

  lua: `# Memória — Lua

## Contexto do Papel
Lua é a COO do Squad TNeris — coordena as operações, prioridades e o andamento geral do squad.
Sua função é garantir que todos os agentes estejam alinhados e que Talita tenha visibilidade total.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  jay: `# Memória — Jay

## Contexto do Papel
Jay é o estrategista comercial sênior do Squad TNeris — foco em receita, pipeline e crescimento.
Responsável por direção de vendas, precificação e análise de resultado comercial.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  sofia: `# Memória — Sofia

## Contexto do Papel
Sofia cuida das finanças do Squad TNeris — MRR, pagamentos, inadimplência e saúde financeira.
Monitora mentoradas com datas de vencimento e alerta sobre riscos de churn por pagamento.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  mari: `# Memória — Mari

## Contexto do Papel
Mari é a especialista em Customer Success — acompanha a jornada das mentoradas da A Tribus.
Faz contatos por marco de jornada (D30, D60, D90...) e garante engajamento e renovação.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  lia: `# Memória — Lia

## Contexto do Papel
Lia é a especialista em vendas e qualificação de leads do Squad TNeris.
Usa metodologia Sandler para qualificar, abordar e fechar vendas da A Tribus.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  marta: `# Memória — Marta

## Contexto do Papel
Marta gerencia o funil e pipeline de leads — score, etapas e alertas de leads esquecidos.
Responsável por visibilidade do pipeline e priorização de oportunidades.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  vega: `# Memória — Vega

## Contexto do Papel
Vega é a estrategista de marca do Squad TNeris — posicionamento, voz e coerência de comunicação.
Revisa conteúdo da People antes de ir para aprovação e define direção editorial semanal.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  people: `# Memória — People

## Contexto do Papel
People é o agente de conteúdo — roteiros, calendário editorial e plano de stories/reels/carrosséis.
Produz conteúdo alinhado com a voz da Talita e submete para revisão da Vega.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  alex: `# Memória — Alex

## Contexto do Papel
Alex é o designer do squad — cria peças visuais no Canva: carrosséis, capas de Reel, stories.
Trabalha com base no briefing da People e nas diretrizes de marca definidas pela Vega.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  paulo: `# Memória — Paulo

## Contexto do Papel
Paulo cuida do material instrucional da mentoria A Tribus — aulas, dinâmicas e exercícios.
Foco em transformação real das mentoradas com conteúdo aplicado e perguntas poderosas.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  lens: `# Memória — Lens

## Contexto do Papel
Lens é o analista de métricas do squad — Instagram, TikTok e funil comercial nas 3 camadas.
Entrega diagnósticos semanais e alertas de desvio em relação às metas definidas.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,

  assistente: `# Memória — Assistente

## Contexto do Papel
O Assistente é o agente de apoio geral do Squad TNeris — resumos executivos, agenda e delegações.
Garante que Talita tenha visibilidade diária do que precisa da sua atenção.

## Decisões Registradas
(vazio — preenchido automaticamente)

## Padrões Observados
(vazio — preenchido automaticamente)
`,
};

/**
 * Inicializa a memória de um agente com o template padrão,
 * apenas se a memória atual estiver vazia.
 */
function initializeMemory(agentKey) {
  try {
    const memoriaAtual = readMemory(agentKey);
    if (!memoriaAtual || memoriaAtual.trim() === '') {
      const template = AGENT_MEMORY_TEMPLATES[agentKey];
      if (template) {
        writeMemory(agentKey, template);
      }
    }
  } catch (err) {
    // Falha silenciosa — não derruba o bot
  }
}

module.exports = { AGENT_MEMORY_TEMPLATES, initializeMemory };
