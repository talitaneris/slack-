const cron = require('node-cron');
const { callClaude } = require('../claude');
const { AGENTS } = require('../agents');
const { refreshAll, getPautas } = require('../curadoria/crawler');
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
  conselho:   process.env.SLACK_CHANNEL_CONSELHO || 'C03PX3KKTJS',
  aprovacoes: process.env.SLACK_CHANNEL_APROVACOES || 'C03PX3KKTJS', // ← cole o ID do #aprovacoes aqui ou sete SLACK_CHANNEL_APROVACOES no Render
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
    prompt: `Plano de conteúdo do dia — máximo 130 palavras, sem emoji por linha, no tom da Talita.
Tema do dia (1 frase — dentro de um pilar: capital oculto / estrutura que liberta / renovação / preeminência).
Stories 12h: gancho de abertura pronto para usar, direto, diagnóstico ou inversão. Nunca começa com "Hoje vou falar sobre".
Feed: é dia de post ou não é — se for, qual formato e tema. Se não for, só diz.
TikTok 18h: gancho de abertura pronto (1-2 frases).
Alex: o que criar, formato, referência objetiva.`,
    maxTokens: 350,
  },
  {
    agent: AGENTS.alex,
    channel: CHANNELS.marketing,
    prompt: `Com base no briefing de People: o que você vai criar hoje (formato, tamanho, canal) e o que precisa para começar. Se não tiver demanda de feed, foca em template ou melhoria de peça existente. Máximo 80 palavras, direto.`,
    maxTokens: 200,
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
      agent: AGENTS.sofia,
      channel: CHANNELS.financeiro,
      prompt: `Lista de A RECEBER da semana — máximo 120 palavras, sem emojis por linha.
Liste quem paga esta semana, valor e data de vencimento. Separa: confirmados vs pendentes.
Calendário fixo: Renata (dia 5, R$1.200), Patricia (dia 10), Damaris (dia 25, R$1.000), Elis (dia 28), Carol (10/04), Brenda (07/04).
Se algum vencimento cair nesta semana: destaque como prioritário.
Se Eli+Aparicio ainda não fecharam renovação: incluir como pendência.`,
      maxTokens: 300,
    },
    {
      agent: AGENTS.vega,
      channel: CHANNELS.marketing,
      prompt: `Direção de comunicação da semana — máximo 100 palavras, sem emoji por linha.
1 mensagem-chave (1 frase concreta — não vaga, não motivacional)
1 pilar (capital oculto / estrutura que liberta / renovação / preeminência)
1 ângulo (diagnóstico direto / inversão / bastidores / prova com profundidade / a vara de Moisés)
Instrução para People: o que executar e onde
Instrução para Alex: formato visual, referência objetiva`,
      maxTokens: 250,
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
      prompt: `Fechamento financeiro da semana — máximo 150 palavras, sem emojis por linha.
1. O que foi pago esta semana vs o que estava previsto (confirmado / pendente / atrasado)
2. Vendas da semana: novos contratos fechados (nome, produto, valor) — se não houve, diz zero
3. Alerta de inadimplência se houver
Calendário: Renata (dia 5, R$1.200), Patricia (dia 10), Damaris (dia 25, R$1.000 — 1ª parcela 25/03), Elis (dia 28), Carol (10/04), Brenda (07/04).
Se algum contrato de renovação continuar pendente (Eli+Aparicio, Thaissa): cobrar status.`,
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

// Arco narrativo semanal — SOAP Opera Sequence (Brunson)
const STORIES_WEEK = {
  0: { tema: 'Pausa ou reflexão', pilar: 'Qualquer', angulo: 'Bastidores', skip: true },
  1: { tema: 'Backstory — o problema real, sem resolver', pilar: 'Capital Oculto', angulo: 'diagnóstico direto', gancho: 'amanhã conto o que muda quando você para de adicionar' },
  2: { tema: 'A parede — o momento em que parou de funcionar', pilar: 'Estrutura que liberta', angulo: 'bastidores reais', gancho: 'a resposta que mudou tudo — amanhã' },
  3: { tema: 'A epifania — o que muda quando você vê diferente', pilar: 'Capital Oculto', angulo: 'a vara de Moisés', gancho: 'me responde qual é a sua alavanca mais fraca' },
  4: { tema: 'Prova real — quem já viveu isso com profundidade', pilar: 'Preeminência', angulo: 'prova com profundidade', gancho: 'quer entender o que foi feito? me responde aqui' },
  5: { tema: 'Oferta natural — o próximo passo para quem se reconheceu', pilar: 'A Tribus', angulo: 'oferta depois da jornada', gancho: 'me manda DM com "diagnóstico" e te conto mais' },
  6: { tema: 'Bastidores — processo com decisões reais, sem resultado pronto', pilar: 'Qualquer', angulo: 'document, don\'t create', gancho: '' },
};

/**
 * Rotina de aprovação de Stories: Vega define direção → People entrega sequência.
 * Vega posta em #aprovacoes. People responde na thread. Talita aprova.
 */
async function runStoriesApprovalRoutine(slackClient, logger) {
  const now = new Date();
  const day = now.getDay();
  const dayInfo = STORIES_WEEK[day];

  if (dayInfo.skip) {
    logger.info('📵 Domingo — sem rotina de Stories agendada.');
    return;
  }

  const dayNames = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const hoje = dayNames[day];

  // ── Passo 1: Vega define a direção e posta em #marketing ──
  const vegaPrompt = `
É ${hoje}. Defina a direção de Stories para hoje.

CONTEXTO DO DIA (obrigatório seguir):
- Tema: ${dayInfo.tema}
- Pilar: ${dayInfo.pilar}
- Ângulo: ${dayInfo.angulo}
- Gancho para fechar: "${dayInfo.gancho}"

Entregue:
1. Mensagem-chave do dia (1 frase concreta — não vaga, não motivacional)
2. Ângulo específico para hoje
3. Instrução para People: o que executar, quantos frames, qual sticker usar (enquete ou caixinha), onde o gancho entra
4. Instrução para Alex: formato visual do frame 1

Máximo 100 palavras. Sem emoji por linha. Sem "estratégia". Fale como Vega — direto, executável.
No final, chame People pelo nome: "@People — sua vez."
`.trim();

  let vegaText;
  try {
    vegaText = await callClaude(AGENTS.vega.system, vegaPrompt, 300);
  } catch (err) {
    logger.error('❌ Erro ao chamar Vega para Stories:', err.message);
    return;
  }

  // Vega posta em #marketing — captura ts para thread
  let vegaPost;
  try {
    vegaPost = await slackClient.chat.postMessage({
      channel: CHANNELS.marketing,
      text: `${AGENTS.vega.icon} *Vega — direção de Stories (${hoje})*\n\n${vegaText}`,
    });
    logger.info('✅ Vega postou direção em #marketing');
  } catch (err) {
    logger.error('❌ Erro ao postar Vega em #marketing:', err.message);
    return;
  }

  // ── Passo 2: People responde na thread do #marketing com a sequência ──
  const peoplePrompt = `
Vega acabou de definir a direção de Stories para hoje (${hoje}):

---
${vegaText}
---

REFERÊNCIA DO DIA:
- Tema: ${dayInfo.tema}
- Pilar: ${dayInfo.pilar}
- Ângulo: ${dayInfo.angulo}

Com base nessa direção, entregue a sequência completa de Stories para hoje.

ESTRUTURA OBRIGATÓRIA (7 frames):
Frame 1 — HOOK: máximo 2 frases. Diagnóstico direto ou inversão. NUNCA começa com saudação ou "Hoje vou falar sobre".
Frame 2 — CONTEXTO: expande o problema. Introduz sticker interativo (enquete ou caixinha) — escreva a pergunta exata do sticker.
Frame 3 — STICKER: o sticker interativo em ação. Inclua a pergunta exata se for caixinha, ou as 2 opções se for enquete.
Frame 4 — DESENVOLVIMENTO: aprofunda, mantém a tensão. Máximo 3 frases.
Frame 5 — VIRADA: o ponto onde a perspectiva muda.
Frame 6 (penúltimo) — CTA: 1 instrução natural. Não "clica no link". Sim: "me responde aqui", "manda DM com X", "salva esse".
Frame 7 — FECHAMENTO: reforço emocional ou gancho para amanhã: "${dayInfo.gancho}"

FORMATO NO SLACK:
*Frame 1 — HOOK*
[texto do frame]

*Frame 2 — CONTEXTO*
[texto + instrução do sticker]

... e assim por diante.

No final: briefing para Alex em 1 linha (formato visual do frame 1).

Aplique o teste do hook antes de entregar: "Uma coach genérica poderia assinar esse Frame 1?" — se sim, reescreve.
Nenhuma palavra proibida. Nenhuma frase de transição de IA.
`.trim();

  let peopleText;
  try {
    peopleText = await callClaude(AGENTS.people.system, peoplePrompt, 600);
  } catch (err) {
    logger.error('❌ Erro ao chamar People para Stories:', err.message);
    return;
  }

  // People responde na thread de Vega em #marketing
  try {
    await slackClient.chat.postMessage({
      channel: CHANNELS.marketing,
      thread_ts: vegaPost.ts,
      text: `${AGENTS.people.icon} *People — sequência pronta*\n\n${peopleText}`,
    });
    logger.info('✅ People respondeu na thread de #marketing');
  } catch (err) {
    logger.error('❌ Erro ao postar People em #marketing:', err.message);
    return;
  }

  // ── Loop: Vega revisa → People refaz até aprovação (máx 3 tentativas) ──
  const MAX_TENTATIVAS = 3;
  let tentativa = 0;
  let aprovado = false;
  let sequenciaFinal = peopleText;
  let feedbackVega = '';

  while (tentativa < MAX_TENTATIVAS && !aprovado) {
    tentativa++;

    const vegaReviewPrompt = `
People entregou a sequência de Stories para hoje (${hoje}). Você é a chefe dela — revise com rigor.${tentativa > 1 ? ` Esta é a tentativa ${tentativa} — ela já ajustou baseada no seu feedback anterior.` : ''}

DIREÇÃO QUE VOCÊ DEU:
---
${vegaText}
---

SEQUÊNCIA QUE PEOPLE ENTREGOU:
---
${sequenciaFinal}
---

Revise frame por frame verificando:
1. O Frame 1 passa no teste do hook? ("Uma coach genérica poderia assinar isso?" — se sim, reprovar)
2. A sequência segue o tema e ângulo que você definiu?
3. Tem alguma palavra proibida (real, presença, jornada, transformação, audiência, engajar, etc)?
4. O sticker interativo está nos frames 2–3?
5. O CTA está no penúltimo frame?
6. O gancho de fechamento está correto: "${dayInfo.gancho}"

Se aprovado: comece com "✅ Aprovado" + 1 frase sobre o que ficou forte.
Se precisar de ajuste: aponte exatamente qual frame e o que reescrever. Seja direta e específica — People vai refazer com base no seu feedback.
Máximo 80 palavras. Fale como Vega.
`.trim();

    let vegaReviewText;
    try {
      vegaReviewText = await callClaude(AGENTS.vega.system, vegaReviewPrompt, 250);
    } catch (err) {
      logger.error(`❌ Erro na revisão de Vega (tentativa ${tentativa}):`, err.message);
      break;
    }

    await slackClient.chat.postMessage({
      channel: CHANNELS.marketing,
      thread_ts: vegaPost.ts,
      text: `${AGENTS.vega.icon} *Vega — revisão${tentativa > 1 ? ` (tentativa ${tentativa})` : ''}*\n\n${vegaReviewText}`,
    }).catch(err => logger.error('Erro ao postar revisão Vega:', err.message));

    aprovado = vegaReviewText.toLowerCase().includes('aprovado');
    feedbackVega = vegaReviewText;

    if (aprovado) break;

    // Vega reprovou — People refaz
    if (tentativa < MAX_TENTATIVAS) {
      const peopleRefazPrompt = `
Vega reprovou sua sequência de Stories e pediu ajustes. Refaça incorporando o feedback dela.

DIREÇÃO ORIGINAL DE VEGA:
---
${vegaText}
---

SUA SEQUÊNCIA ANTERIOR:
---
${sequenciaFinal}
---

FEEDBACK DE VEGA:
---
${feedbackVega}
---

Reescreva a sequência completa de 7 frames incorporando todos os ajustes que Vega pediu.
Mantenha a mesma estrutura (Frame 1 HOOK → Frame 2 CONTEXTO → Frame 3 STICKER → Frame 4 DESENVOLVIMENTO → Frame 5 VIRADA → Frame 6 CTA → Frame 7 FECHAMENTO).
Aplique o teste do hook antes de entregar. Nenhuma palavra proibida.
`.trim();

      let peopleRefazText;
      try {
        peopleRefazText = await callClaude(AGENTS.people.system, peopleRefazPrompt, 600);
      } catch (err) {
        logger.error(`❌ Erro ao People refazer (tentativa ${tentativa}):`, err.message);
        break;
      }

      sequenciaFinal = peopleRefazText;

      await slackClient.chat.postMessage({
        channel: CHANNELS.marketing,
        thread_ts: vegaPost.ts,
        text: `${AGENTS.people.icon} *People — sequência refeita (tentativa ${tentativa + 1})*\n\n${peopleRefazText}`,
      }).catch(err => logger.error('Erro ao postar People refazer:', err.message));
    }
  }

  // ── Após o loop: envia para #aprovacoes se aprovado ──
  if (aprovado) {
    await slackClient.chat.postMessage({
      channel: CHANNELS.aprovacoes,
      text: `${AGENTS.people.icon} *Stories de hoje (${hoje}) — aprovado por Vega*\n\n${sequenciaFinal}\n\n---\n_Discussão completa em #marketing. ✅ para aprovar ou responda aqui para ajustar._`,
    }).catch(err => logger.error('Erro ao postar em #aprovacoes:', err.message));
    logger.info(`✅ Stories aprovados por Vega (${tentativa} tentativa(s)) — postado em #aprovacoes`);
  } else {
    // Esgotou as tentativas sem aprovação — avisa Talita
    await slackClient.chat.postMessage({
      channel: CHANNELS.aprovacoes,
      text: `⚠️ *Stories de hoje (${hoje}) — não aprovados por Vega após ${MAX_TENTATIVAS} tentativas.*\nRevise a thread em #marketing e decida como prosseguir.`,
    }).catch(err => logger.error('Erro ao postar aviso em #aprovacoes:', err.message));
    logger.warn(`⚠️ Stories não aprovados após ${MAX_TENTATIVAS} tentativas`);
  }
}

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

  // ── 6h BRT: atualiza curadoria + pautas IA + envia para #marketing ──
  cron.schedule('0 6 * * *', async () => {
    logger.info('📰 Cron 6h — atualizando curadoria e gerando pautas');
    try {
      await refreshAll();
      logger.info('✅ Curadoria e pautas atualizadas');

      const pautas = getPautas();
      if (!pautas || pautas.length === 0) return;

      // Monta mensagem com top 3 pautas para #marketing
      const linhas = pautas.slice(0, 3).map((p, i) => {
        return `*${i + 1}. ${p.titulo}* — _${p.fonte}_\n→ *ICP:* ${p.relevancia}\n→ *Ângulo Talita:* ${p.angulo}\n→ *Hook pronto:* "${p.hook}"`;
      }).join('\n\n');

      await slackClient.chat.postMessage({
        channel: CHANNELS.marketing,
        text: `✍️ *People — Pautas quentes de hoje (${new Date().toLocaleDateString('pt-BR')})*\n\nEssas são as 3 mais relevantes para o ICP. Use como base para Stories, Reel ou carrossel.\n\n${linhas}\n\n_Ver todas em: https://slack-soab.onrender.com/curadoria_`,
      });
      logger.info('✅ Pautas enviadas para #marketing');
    } catch (err) {
      logger.error('❌ Erro na curadoria 6h:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── 8h BRT diário (seg–sab): Vega dirige → People entrega Stories em #marketing → resumo final em #aprovacoes ──
  cron.schedule('5 8 * * 1-6', async () => {
    logger.info('📱 Cron 8h05 — Rotina de Stories (Vega → People em #marketing → #aprovacoes)');
    await runStoriesApprovalRoutine(slackClient, logger);
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

  logger.info('🗓️ Scheduler iniciado — 6h curadoria+pautas | 6h30 briefing | 8h rotinas+stories | 9h30 seg conselho | 18h métricas | 0h cleanup');
}

module.exports = { initScheduler, runStoriesApprovalRoutine };
