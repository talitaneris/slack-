const cron = require('node-cron');
const { callClaude } = require('../claude');
const { AGENTS } = require('../agents');
const { refreshAll } = require('../curadoria/crawler');
const { getPendingFor, cleanup } = require('../queue/index');

// IDs dos canais do Slack
const CHANNELS = {
  talita:     'C0AMYHFKY93',
  squadgeral: 'C0AN20EFA02',
  marketing:  'C0AMR167B4L',
  vendas:     'C0AMJ13D85T',
  produto:    'C0AMR126AN8',
  gestao:     'C03PX3KKTJS',
  financeiro: 'C0AMZU5RFM4',
  alertas:    'C03PY24RJJJ',
  conselho:   process.env.SLACK_CHANNEL_CONSELHO || 'C03PX3KKTJS', // ← cole o ID do #conselho aqui ou sete SLACK_CHANNEL_CONSELHO no Render
};

// Rotinas diárias — rodam todo dia às 8h BRT
const DAILY_ROUTINES = [
  {
    agent: AGENTS.assistente,
    channel: CHANNELS.talita,
    prompt: `Gere o resumo executivo do dia para Talita. Inclua: saudação, foco principal do dia, lembretes recorrentes do squad (dia 1 = Sofia confirma MRR; dia 5 = inadimplência; dia 20 = estratégia mensal Jay; Brenda e Carol com últimas parcelas em abril — renovação urgente), e: o que mais precisa da atenção de Talita hoje? Seja concisa, use emojis. Máximo 180 palavras.`,
    maxTokens: 400,
  },
  {
    agent: AGENTS.lua,
    channel: CHANNELS.squadgeral,
    prompt: `Abra o dia do Squad TNeris. Inclua: foco principal do dia por área (Marketing / Vendas / CS / Produto / Gestão), algum alerta ou prioridade especial, e a pergunta do dia para o squad: o que cada agente precisa resolver hoje? Máximo 180 palavras.`,
    maxTokens: 400,
  },
  {
    agent: AGENTS.people,
    channel: CHANNELS.marketing,
    prompt: `Gere o plano de conteúdo do dia:\n1. STORIES (12h e 19h) — tema, gancho de abertura, o que mostrar em cada tela, CTA\n2. FEED (Reels às 19h ou Carrossel — 3 Reels + 2 Carrosséis por semana) — se for dia de post de feed, defina tema e gancho. Se não for, indique claramente.\n3. TIKTOK (18h) — tema e gancho de abertura\n4. BRIEFING para Alex: o que o designer precisa criar hoje. Máximo 250 palavras.`,
    maxTokens: 500,
  },
  {
    agent: AGENTS.alex,
    channel: CHANNELS.marketing,
    prompt: `Com base no plano de People, declare o que você vai criar hoje: quais peças (carrossel / capa de Reel / story / post estático), o mood visual de cada peça, e o que precisa do briefing de People para começar. Se não houver demanda de feed hoje, foque em melhoria de templates. Máximo 180 palavras.`,
    maxTokens: 350,
  },
  {
    agent: AGENTS.lia,
    channel: CHANNELS.vendas,
    prompt: `Defina o foco de vendas do dia: etapa do funil para priorizar hoje, ação específica (prospectar / qualificar / follow-up / fechar), mensagem de abordagem para o perfil do dia, e meta do dia (ex: 3 contatos novos, 1 call, 1 proposta). Máximo 180 palavras.`,
    maxTokens: 350,
  },
  {
    agent: AGENTS.marta,
    channel: CHANNELS.vendas,
    prompt: `Gere o snapshot do pipeline do dia: onde estão os leads por etapa (prospecção / qualificação / proposta / fechamento), top 3 leads que merecem atenção hoje com motivo, e algum alerta de lead esquecido há mais de 5 dias. Máximo 180 palavras.`,
    maxTokens: 350,
  },
  {
    agent: AGENTS.paulo,
    channel: CHANNELS.produto,
    prompt: `Prepare o suporte instrucional para a aula da mentoria A Tribus de hoje. Inclua: objetivo de aprendizagem do dia, exercício ou dinâmica recomendada (com instrução clara), pergunta poderosa para fazer às mentoradas, e como encerrar a sessão gerando comprometimento. Máximo 200 palavras.`,
    maxTokens: 400,
  },
];

// Rotinas por dia da semana (além das diárias)
const WEEKLY_ROUTINES = {
  1: [ // Segunda-feira
    {
      agent: AGENTS.vega,
      channel: CHANNELS.marketing,
      prompt: `Defina a direção de comunicação desta semana: mensagem-chave (1 frase de posicionamento), ângulo predominante (bastidores / autoridade / prova social / conexão pessoal / oferta), tema emocional que guia o conteúdo, e instrução específica para People e Alex. Máximo 180 palavras.`,
      maxTokens: 400,
    },
    {
      agent: AGENTS.jay,
      channel: CHANNELS.vendas,
      prompt: `Defina a prioridade comercial da semana: produto a impulsionar (A Tribus mentoria), foco em leads F1 (impulsionamento) ou R1 (indicação), meta de receita semanal, e direção específica para Lia e Marta. Máximo 180 palavras.`,
      maxTokens: 400,
    },
    {
      agent: AGENTS.lens,
      channel: CHANNELS.gestao,
      prompt: `Analise as métricas de abertura de semana nas 3 camadas (o que / por quê / o que fazer): Instagram (engajamento, alcance, seguidores), TikTok (views, retenção), Funil comercial (leads, conversão). Compare com a semana anterior e indique o maior gargalo atual. Máximo 200 palavras.`,
      maxTokens: 450,
    },
  ],
  2: [ // Terça-feira
    {
      agent: AGENTS.mari,
      channel: CHANNELS.produto,
      prompt: `Declare sua disponibilidade de CS para a semana e programe os contatos por marco de jornada (D30, D60, D90, D120, D150, D180). Destaque urgência: Brenda e Carol têm últimas parcelas em abril — contato de renovação prioritário. Liste quem deve ser contatado esta semana e por qual canal (WhatsApp / sessão). Máximo 200 palavras.`,
      maxTokens: 400,
    },
  ],
  3: [ // Quarta-feira
    {
      agent: AGENTS.lens,
      channel: CHANNELS.gestao,
      prompt: `Execute o mid-week check de métricas nas 3 camadas (o que / por quê / o que fazer): Instagram, TikTok e funil comercial. Foque no desvio mais crítico em relação à meta da semana e indique ação corretiva com responsável. Máximo 200 palavras.`,
      maxTokens: 450,
    },
  ],
  5: [ // Sexta-feira
    {
      agent: AGENTS.jay,
      channel: CHANNELS.gestao,
      prompt: `Gere o dashboard semanal de receita: receita da semana vs meta, pipeline por etapa, fechamentos, conversão, e os 3 alertas para a semana seguinte. Formato: tabela + síntese em bullets. Máximo 230 palavras.`,
      maxTokens: 500,
    },
    {
      agent: AGENTS.sofia,
      channel: CHANNELS.financeiro,
      prompt: `Gere o relatório de MRR da semana: MRR atual vs meta do mês, pagamentos confirmados, pendências e alertas de inadimplência. Mentoradas com datas: Renata (dia 5), Patricia (dia 10), Damaris (dia 25), Elis (dia 28), Brenda (07/04 — última), Carol (10/04 — última). Máximo 180 palavras.`,
      maxTokens: 400,
    },
    {
      agent: AGENTS.lens,
      channel: CHANNELS.gestao,
      prompt: `Fecha a semana com análise de métricas nas 3 camadas. Compare o resultado com a meta e indique: o que vai bem, o que está em risco, e a prioridade de ação para a semana seguinte com responsável. Máximo 200 palavras.`,
      maxTokens: 400,
    },
  ],
  6: [ // Sábado
    {
      agent: AGENTS.lua,
      channel: CHANNELS.squadgeral,
      prompt: `Execute o debrief semanal. Formato: 🟢 O que funcionou bem / 🟡 O que melhorar / 💡 Aprendizado da semana / 📌 Foco da próxima semana. Máximo 220 palavras.`,
      maxTokens: 500,
    },
  ],
};

/**
 * Executa uma rotina: chama o Claude e posta no canal do Slack.
 */
async function runRoutine(routine, slackClient, logger) {
  const { agent, channel, prompt, maxTokens } = routine;
  try {
    const text = await callClaude(agent.system, prompt, maxTokens);
    await slackClient.chat.postMessage({
      channel,
      text: `${agent.icon} *${agent.title}*\n\n${text}`,
    });
    logger.info(`✅ Rotina executada: ${agent.title} → ${channel}`);
  } catch (err) {
    logger.error(`❌ Erro na rotina ${agent.title}:`, err.message);
  }
}

/**
 * Inicializa o scheduler.
 */
function initScheduler(slackClient, logger) {

  // ── 8h BRT: rotinas diárias do squad ──
  cron.schedule('0 8 * * *', async () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    logger.info(`🕗 Rodando rotinas do dia ${dayOfWeek} (${now.toISOString()})`);

    for (const routine of DAILY_ROUTINES) {
      await runRoutine(routine, slackClient, logger);
    }

    const weeklyRoutines = WEEKLY_ROUTINES[dayOfWeek] || [];
    for (const routine of weeklyRoutines) {
      await runRoutine(routine, slackClient, logger);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── 9h BRT: atualiza curadoria de notícias ──
  cron.schedule('0 9 * * *', async () => {
    logger.info('📰 Cron 9h — atualizando curadoria');
    try {
      await refreshAll();
      logger.info('✅ Curadoria atualizada');
    } catch (err) {
      logger.error('❌ Erro na curadoria:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── 9h30 toda segunda: Conselho Estratégico com Jay ──
  cron.schedule('30 9 * * 1', async () => {
    logger.info('📊 Cron 9h30 segunda — Conselho Estratégico');
    await runRoutine({
      agent:     AGENTS.jay,
      channel:   CHANNELS.conselho,
      maxTokens: 700,
      prompt: `É segunda-feira, 9h30. Conduza o Conselho Estratégico Semanal da TNeris.
Formato obrigatório:
1. 📊 JAY (você) — Números da semana: MRR, conversões, renovações pendentes, gap vs. meta
2. 💡 JAY ABRAHAM — Capital oculto: o que já existe e não está sendo explorado? Qual alavanca (clientes / ticket / frequência) está mais fraca?
3. 💰 ALEX HORMOZI — A oferta está forte o suficiente? Equação de valor, o que trim, o que stack?
4. 🎯 RUSSELL BRUNSON — Saúde do funil: temperatura do tráfego, onde está perdendo lead, Value Ladder sendo usado?
5. 📱 GARY VEE — Atenção e conteúdo: onde está a atenção do ICP essa semana? O que está gerando DM qualificada?

Feche com:
→ *1 decisão estratégica da semana*
→ *3 ações táticas para executar antes da próxima segunda*
→ *1 número para monitorar*`,
    }, slackClient, logger);
  }, { timezone: 'America/Sao_Paulo' });

  // ── 18h BRT diário — Lens resume as métricas do dia ──
  cron.schedule('0 18 * * *', async () => {
    logger.info('📈 Cron 18h — Lens resumindo métricas do dia');
    await runRoutine({
      agent:     AGENTS.lens,
      channel:   CHANNELS.gestao,
      maxTokens: 350,
      prompt:    'Lens, fim de tarde. Faça um resumo das métricas do dia: o que se destacou positivamente, o que ficou abaixo do esperado, e 1 ajuste para amanhã. Máximo 150 palavras.',
    }, slackClient, logger);
  }, { timezone: 'America/Sao_Paulo' });

  // ── 6h30 BRT diário — Lua lê a fila e gera briefing consolidado ──
  cron.schedule('30 6 * * *', async () => {
    logger.info('🌙 Cron 6h30 — Lua gerando briefing de fila');
    try {
      // Monta resumo das tarefas pendentes por agente
      const agentes = Object.values(AGENTS).map(a => a.key);
      const resumoPorAgente = [];

      for (const key of agentes) {
        try {
          const pendentes = getPendingFor(key);
          if (pendentes.length > 0) {
            resumoPorAgente.push(`• ${key}: ${pendentes.length} tarefa(s) pendente(s)`);
          }
        } catch (qErr) {
          // Ignora erro de fila individual
        }
      }

      const queueSummary = resumoPorAgente.length > 0
        ? resumoPorAgente.join('\n')
        : 'Nenhuma tarefa pendente na fila.';

      await runRoutine({
        agent:     AGENTS.lua,
        channel:   CHANNELS.talita,
        maxTokens: 350,
        prompt:    `Lua, briefing de 6h30. Tarefas pendentes na fila:\n${queueSummary}\n\nGere um resumo do que o squad precisa resolver hoje. Máximo 150 palavras.`,
      }, slackClient, logger);

    } catch (err) {
      logger.error('Erro no cron 6h30 Lua:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── Meia-noite BRT diário — limpeza da fila inter-agente ──
  cron.schedule('0 0 * * *', () => {
    try {
      const removidas = cleanup();
      if (removidas > 0) {
        logger.info(`🧹 Cleanup da fila: ${removidas} tarefa(s) antiga(s) removida(s)`);
      }
    } catch (err) {
      logger.error('Erro no cleanup da fila:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  logger.info('🗓️ Scheduler iniciado — 6h30 briefing | 8h rotinas | 9h curadoria | 9h30 seg conselho | 18h métricas | 0h cleanup');
}

module.exports = { initScheduler };
