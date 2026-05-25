const cron = require('node-cron');
const { callClaudeFast: callClaude } = require('../claude');
const { AGENTS } = require('../agents');
const { refreshAll, getPautas } = require('../curadoria/crawler');
const { getPendingFor, cleanup } = require('../queue/index');
const { getPrivateContextForAgent } = require('../privateContext');
const { listarEventos } = require('../services/calendar');
const { listarEmailsManha } = require('../services/email');
const { criarReuniaoZoom, isZoomConfigured } = require('../services/zoom');
const { sendTelegramMessage, getMilestoneContext } = require('../telegram/mariah');
const { manutencaoSemanal, buildMariahMemoryContext, consolidarMemoriaDiaria } = require('../memory/mariah');

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

function getBrtDateContext() {
  const now = new Date();
  const brt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);

  return `Agora em America/Sao_Paulo: ${brt}. Use esta data. Não use data antiga, placeholder ou exemplo como fato.`;
}

function getBrtDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const value = type => parts.find(part => part.type === type)?.value;
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
  };
}

function getBrtTodayRange() {
  const { year, month, day } = getBrtDateParts();
  return {
    start: new Date(`${year}-${month}-${day}T00:00:00-03:00`),
    end: new Date(`${year}-${month}-${day}T23:59:59-03:00`),
    label: `${day}/${month}/${year}`,
  };
}

const SCHEDULER_LAYOUT_RULE = `
PADRÃO DE LAYOUT PARA ROTINAS NO SLACK:
- Máximo 90 palavras em rotina comum.
- Máximo 3 blocos curtos.
- Não use emoji.
- Não use #, ##, linha divisória, tabela ou caixa alta como título.
- Use *negrito* com uma estrela quando precisar destacar. Nunca use **duas estrelas**.
- Não use placeholder: [agora], [Nome], [data], [lead A], [preciso da data].
- Não invente número, lead, pipeline, status, aula, pagamento ou métrica.
- Se faltar dado, responda com decisão provisória e acione Nara ou agente dono. Não devolva coleta para Talita.
- Formato preferido:
Leitura: [1 frase]
Ação: [1 ação concreta]
Dono: [agente responsável]
`;

function formatForSlack(text = '') {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '*$1*')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/:[a-z0-9_+-]+:/gi, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\[[^\]\n]*(?:agora|data|nome|lead|preciso)[^\]\n]*\]/gi, '[dado a confirmar]')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function buildRoutineSystem(agent) {
  let system = `${getBrtDateContext()}\n\n${SCHEDULER_LAYOUT_RULE}\n\n${agent.system}`;

  try {
    const privateContext = await getPrivateContextForAgent(agent.key);
    if (privateContext && privateContext.trim()) {
      system = `${system}\n\n${privateContext}`;
    }
  } catch {
    // Rotina continua mesmo sem contexto privado
  }

  return system;
}

async function buildMariahMorningAgendaContext(logger = console) {
  const { start, end, label } = getBrtTodayRange();

  try {
    const agenda = await listarEventos(start, end);
    return [
      `AGENDA ATUAL DE HOJE (${label}) — FONTE: Google Calendar ao vivo.`,
      agenda,
      '',
      'REGRAS PARA MARIAH:',
      '- Esta agenda atual vence qualquer rotina fixa, memoria antiga ou suposicao.',
      '- Nao diga que o dia esta livre se houver eventos acima.',
      '- Nao invente treino 8h30, aula 19h, folga ou dia protegido se nao estiver na agenda atual.',
      '- Se a agenda vier com erro tecnico, diga que nao conseguiu consultar e acione Nara. Nao invente.',
      '- No briefing, cite os principais blocos do dia e a protecao concreta de tempo.',
    ].join('\n');
  } catch (err) {
    logger.warn?.('Agenda atual da Mariah indisponivel no briefing:', err.message);
    return [
      `AGENDA ATUAL DE HOJE (${label}) — ERRO AO CONSULTAR GOOGLE CALENDAR.`,
      `Erro: ${err.message}`,
      '',
      'REGRAS PARA MARIAH:',
      '- Nao invente a agenda.',
      '- Diga que a agenda ao vivo falhou e acione Nara para diagnosticar.',
    ].join('\n');
  }
}

async function buildMariahMorningInboxContext(logger = console) {
  try {
    const emails = await listarEmailsManha({ limit: 12, hours: 14 });
    return [
      'E-MAILS DA MANHA — FONTE: Zoho Mail API.',
      emails,
      '',
      'REGRAS PARA MARIAH:',
      '- Nao despeje e-mail inteiro no Slack.',
      '- Classifique em financeiro, comercial, suporte/risco, triagem ou baixo impacto.',
      '- Leve para Talita apenas decisao que depende dela, risco ou oportunidade.',
      '- Se Zoho nao estiver configurado, registre como acesso pendente. Nao finja que leu.',
    ].join('\n');
  } catch (err) {
    logger.warn?.('Zoho Mail indisponivel no briefing:', err.message);
    return [
      'E-MAILS DA MANHA — ERRO AO CONSULTAR ZOHO MAIL.',
      `Erro: ${err.message}`,
      '',
      'REGRAS PARA MARIAH:',
      '- Nao invente e-mails.',
      '- Diga que o acesso falhou e acione Nara para diagnosticar.',
    ].join('\n');
  }
}

// Rotinas diárias — rodam todo dia às 8h BRT
const DAILY_ROUTINES = [
  {
    agent: AGENTS.nara,
    channel: CHANNELS.squadgeral,
    prompt: `Abra o dia do squad como Nara. Não invente status por área.
Formato:
Leitura: estado da operação com base no que existe.
Risco: maior risco se não houver dados atualizados.
Ação: o que Nara vai cobrar hoje e de quem.`,
    maxTokens: 400,
  },
  {
    agent: AGENTS.people,
    channel: CHANNELS.marketing,
    prompt: `Plano de conteúdo do dia. Não use capital oculto, "não é sobre", "isso é/isso não é", números inventados ou caso inventado.
Formato:
Direção: 1 frase.
Stories: hook + desenvolvimento em até 3 frames.
Alex: briefing visual em 1 linha.`,
    maxTokens: 350,
  },
  {
    agent: AGENTS.alex,
    channel: CHANNELS.marketing,
    prompt: `Com base no briefing mais recente de People/Vega no canal, diga o que Alex deve criar. Se faltar briefing, não peça 5 informações para Talita: acione People/Vega e entregue uma ação provisória simples.`,
    maxTokens: 200,
  },
  {
    agent: AGENTS.lia,
    channel: CHANNELS.vendas,
    prompt: `Defina o foco de vendas do dia sem inventar ICP, meta ou lead. A realidade atual é operação pequena. Se não houver pipeline atualizado, acione Nara.
Formato:
Prioridade: 1 ação comercial de hoje.
Abordagem: 1 mensagem curta, sem "faz sentido?".
Pipeline: confirme estágio dos leads ativos ou sinalize lacuna.`,
    maxTokens: 350,
  },
  {
    agent: AGENTS.paulo,
    channel: CHANNELS.produto,
    prompt: `Prepare apoio de produto para A Tribus. Aula fixa é segunda às 19h; só diga "aula hoje" se hoje for segunda-feira.
Se faltar tema/fase, não devolva tudo para Talita. Entregue uma estrutura provisória e acione Mari/Nara para levantar travas das mentoradas.
Formato:
Leitura: [se há aula hoje ou preparação]
Entrega provisória: [objetivo + exercício curto]
Dono: [Paulo, Mari ou Nara]`,
    maxTokens: 400,
  },
];

// Rotinas por dia da semana (além das diárias)
const WEEKLY_ROUTINES = {
  1: [ // Segunda-feira
    {
      agent: AGENTS.vega,
      channel: CHANNELS.marketing,
      prompt: `Direção de comunicação da semana — máximo 100 palavras, sem emoji por linha.
1 mensagem-chave (1 frase concreta — não vaga, não motivacional)
1 pilar (extração do que já existe / estrutura que liberta / renovação / preeminência)
1 ângulo (diagnóstico direto / inversão / bastidores / prova com profundidade / a vara de Moisés)
Instrução para People: o que executar e onde
Instrução para Alex: formato visual, referência objetiva`,
      maxTokens: 250,
    },
    {
      agent: AGENTS.jay,
      channel: CHANNELS.vendas,
      prompt: `É segunda-feira. Defina a prioridade comercial da semana partindo da realidade atual do negócio e dos 4 focos definidos:
1. Evento — o que avançou? Qual o próximo passo concreto esta semana?
2. 3 turmas de 10 pessoas — quantas pessoas encaminhadas? O que trava?
3. Mini aulas no Instagram — saíram? Quantas? O que Paulo e People precisam fazer?
4. Aula para 2 pessoas — alguma vendida? Preço e formato já definidos?

Regra: partir do que existe, não do que gostaríamos de ter. Realidade atual: ~R$15k/mês, 17 mentoradas ativas, caixa pressionado.
Formato: Foco da semana / O que Jay vai entregar / O que Lia faz / O mínimo que Talita decide. Máximo 180 palavras.`,
      maxTokens: 400,
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
      agent: AGENTS.jay,
      channel: CHANNELS.gestao,
      prompt: `Mid-week check dos 4 focos — sem inventar métrica ou dado.
Evento: está avançando? O que travou esta semana?
Turmas: leads encaminhados? Lia reportou algo?
Mini aulas: saíram?
Aula 2 pessoas: algum movimento?
Se faltar dado, sinalize lacuna e acione Nara/Lia. Máximo 90 palavras.`,
      maxTokens: 300,
    },
  ],
  5: [ // Sexta-feira
    {
      agent: AGENTS.jay,
      channel: CHANNELS.gestao,
      prompt: `Dashboard de fechamento semanal — somente dados confirmados. Sem tabela.
Receita da semana: confirmada vs prevista.
Status dos 4 focos: o que avançou, o que travou.
Se faltar dado, acione Nara/Lia e entregue decisão provisória. Máximo 120 palavras.`,
      maxTokens: 400,
    },
  ],
  6: [ // Sábado
    {
      agent: AGENTS.nara,
      channel: CHANNELS.squadgeral,
      prompt: `Execute o debrief semanal sem emoji e sem relatório longo. Formato: Funcionou / Travou / Próxima ação. Máximo 100 palavras.`,
      maxTokens: 500,
    },
  ],
};

// Arco narrativo semanal — SOAP Opera Sequence (Brunson)
const STORIES_WEEK = {
  0: { tema: 'Pausa ou reflexão', pilar: 'Qualquer', angulo: 'Bastidores', skip: true },
  1: { tema: 'Backstory — o problema concreto, sem resolver', pilar: 'Extração do que já existe', angulo: 'diagnóstico direto', gancho: 'amanhã conto o que muda quando você para de adicionar' },
  2: { tema: 'A parede — o momento em que parou de funcionar', pilar: 'Estrutura que liberta', angulo: 'bastidores reais', gancho: 'a resposta que mudou tudo — amanhã' },
  3: { tema: 'A epifania — o que muda quando você vê diferente', pilar: 'Extração do que já existe', angulo: 'a vara de Moisés', gancho: 'me responde qual é a sua alavanca mais fraca' },
  4: { tema: 'Prova concreta — quem já viveu isso com profundidade', pilar: 'Preeminência', angulo: 'prova com profundidade', gancho: 'quer entender o que foi feito? me responde aqui' },
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
    vegaText = formatForSlack(await callClaude(await buildRoutineSystem(AGENTS.vega), vegaPrompt, 300));
  } catch (err) {
    logger.error('❌ Erro ao chamar Vega para Stories:', err.message);
    return;
  }

  // Vega posta em #marketing — captura ts para thread
  let vegaPost;
  try {
    vegaPost = await slackClient.chat.postMessage({
      channel: CHANNELS.marketing,
      text: `*Vega* — direção de Stories (${hoje})\n${vegaText}`,
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
    peopleText = formatForSlack(await callClaude(await buildRoutineSystem(AGENTS.people), peoplePrompt, 600));
  } catch (err) {
    logger.error('❌ Erro ao chamar People para Stories:', err.message);
    return;
  }

  // People responde na thread de Vega em #marketing
  try {
    await slackClient.chat.postMessage({
      channel: CHANNELS.marketing,
      thread_ts: vegaPost.ts,
      text: `*People* — sequência pronta\n${peopleText}`,
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
3. Tem alguma palavra proibida (presença, jornada, transformação, audiência, engajar, etc)?
4. O sticker interativo está nos frames 2–3?
5. O CTA está no penúltimo frame?
6. O gancho de fechamento está correto: "${dayInfo.gancho}"

Se aprovado: comece com "✅ Aprovado" + 1 frase sobre o que ficou forte.
Se precisar de ajuste: aponte exatamente qual frame e o que reescrever. Seja direta e específica — People vai refazer com base no seu feedback.
Máximo 80 palavras. Fale como Vega.
`.trim();

    let vegaReviewText;
    try {
      vegaReviewText = formatForSlack(await callClaude(await buildRoutineSystem(AGENTS.vega), vegaReviewPrompt, 250));
    } catch (err) {
      logger.error(`❌ Erro na revisão de Vega (tentativa ${tentativa}):`, err.message);
      break;
    }

    await slackClient.chat.postMessage({
      channel: CHANNELS.marketing,
      thread_ts: vegaPost.ts,
      text: `*Vega* — revisão${tentativa > 1 ? ` (tentativa ${tentativa})` : ''}\n${vegaReviewText}`,
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
        peopleRefazText = formatForSlack(await callClaude(await buildRoutineSystem(AGENTS.people), peopleRefazPrompt, 600));
      } catch (err) {
        logger.error(`❌ Erro ao People refazer (tentativa ${tentativa}):`, err.message);
        break;
      }

      sequenciaFinal = peopleRefazText;

      await slackClient.chat.postMessage({
        channel: CHANNELS.marketing,
        thread_ts: vegaPost.ts,
        text: `*People* — sequência refeita (tentativa ${tentativa + 1})\n${peopleRefazText}`,
      }).catch(err => logger.error('Erro ao postar People refazer:', err.message));
    }
  }

  // ── Após o loop: envia para #aprovacoes se aprovado ──
  if (aprovado) {
    await slackClient.chat.postMessage({
      channel: CHANNELS.aprovacoes,
      text: `*Stories de hoje (${hoje}) — aprovado por Vega*\n${formatForSlack(sequenciaFinal)}\n\nDiscussão completa em #marketing. Responda APROVADO ou REVISAR com o ajuste.`,
    }).catch(err => logger.error('Erro ao postar em #aprovacoes:', err.message));
    logger.info(`✅ Stories aprovados por Vega (${tentativa} tentativa(s)) — postado em #aprovacoes`);
  } else {
    // Esgotou as tentativas sem aprovação — avisa Talita
    await slackClient.chat.postMessage({
      channel: CHANNELS.aprovacoes,
      text: `*Stories de hoje (${hoje}) — não aprovados por Vega após ${MAX_TENTATIVAS} tentativas.*\nRevise a thread em #marketing e decida como prosseguir.`,
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
    if (!agent) {
      logger.warn('⚠️ Rotina ignorada: agente inexistente.');
      return;
    }

    const system = await buildRoutineSystem(agent);
    let routinePrompt = prompt;

    if (agent.key === AGENTS.assistente.key) {
      const agendaContext = await buildMariahMorningAgendaContext(logger);
      const inboxContext = await buildMariahMorningInboxContext(logger);
      routinePrompt = `${prompt}\n\n${agendaContext}\n\n${inboxContext}`;
    }

    const text = formatForSlack(await callClaude(system, routinePrompt, maxTokens));
    const messageText = agent.key === AGENTS.assistente.key
      ? text
      : `*${agent.title}* — ${agent.role}\n${text}`;

    await slackClient.chat.postMessage({
      channel,
      text: messageText,
    });
    logger.info(`✅ Rotina executada: ${agent.title} → ${channel}`);
  } catch (err) {
    logger.error(`❌ Erro na rotina ${agent.title}:`, err.message);
  }
}

// ─── REATIVA: alerta quando algo exige atenção ───────────────
async function runReativa(logger) {
  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!chatId) return;

  const alertas = [];

  // Milestones urgentes (≤ 7 dias)
  const milestones = getMilestoneContext();
  const urgentes = (milestones.match(/• (.+?): (\d+) dia/g) || [])
    .filter(m => {
      const dias = parseInt(m.match(/(\d+) dia/)?.[1] || '99');
      return dias <= 7;
    });
  if (urgentes.length) {
    alertas.push('Prazo crítico:\n' + urgentes.map(u => u.replace('• ', '- ')).join('\n'));
  }

  // Agenda de hoje — reuniões sem pauta ou de alto impacto
  try {
    const { start, end } = getBrtTodayRange();
    const eventos = await listarEventos(start, end);
    const altoImpacto = eventos.filter(e =>
      e.summary && ['lead', 'cliente', 'venda', 'proposta', 'fechamento', 'negoci'].some(k =>
        e.summary.toLowerCase().includes(k)
      )
    );
    if (altoImpacto.length) {
      alertas.push('Hoje tem reunião comercial:\n' + altoImpacto.map(e => `- ${e.summary}`).join('\n') + '\nLia está avisada?');
    }
  } catch {}

  if (alertas.length === 0) return; // nada urgente — silêncio

  const memoria = await buildMariahMemoryContext();
  const system = `Você é a Mariah, modo REATIVA. São 8h. Há alertas que precisam de atenção agora.
Seja direta e breve. Máximo 80 palavras. Sem saudação. Sem emoji.
Formato: [alerta] / O que precisa acontecer / Quem resolve
${memoria}`;

  const msg = await callClaude(system, `Alertas de hoje:\n${alertas.join('\n\n')}`, 250);
  await sendTelegramMessage(chatId, msg);
  logger.info('[reativa] Alerta enviado');
}

// ─── PROATIVA: age sem ser pedida ────────────────────────────
async function runProativa(tipo, slackClient, logger) {
  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;

  if (tipo === 'quinta-gravacao') {
    // Quinta é dia de gravação — squad já sabe o que fazer?
    if (_sharedSlackClient) {
      const system = await buildRoutineSystem(AGENTS.paulo);
      const texto = formatForSlack(await callClaude(
        system,
        'É quinta-feira, dia de gravação da Talita. Qual é o conteúdo previsto para hoje? Entregue o roteiro ou estrutura do que vai ser gravado. Se não há roteiro definido, aponte o tema mais urgente com base nos 4 focos do negócio. Máximo 120 palavras.',
        300
      ));
      await _sharedSlackClient.chat.postMessage({ channel: CHANNELS.produto, text: `*Paulo* — dia de gravação\n${texto}` });
    }
    if (chatId) {
      await sendTelegramMessage(chatId, 'Hoje é quinta — dia de gravação. Paulo já abriu o roteiro no #produto.');
    }
    logger.info('[proativa] Quinta gravação acionada');
  }

  if (tipo === 'quarta-leads') {
    // Quarta-feira: check de leads para Turma 1
    if (_sharedSlackClient) {
      const system = await buildRoutineSystem(AGENTS.lia);
      const milestones = getMilestoneContext();
      const texto = formatForSlack(await callClaude(
        system,
        `É quarta-feira. Faça um check dos leads para a Turma 1 da A Base (início 09/06). Quantos foram abordados? Quantos estão quentes? O que trava? O que Lia faz hoje para avançar? Máximo 100 palavras.\n${milestones}`,
        250
      ));
      await _sharedSlackClient.chat.postMessage({ channel: CHANNELS.vendas, text: `*Lia* — check de leads Turma 1\n${texto}` });
    }
    logger.info('[proativa] Quarta leads check acionado');
  }
}

// ─── PREDITIVA: antecipa riscos antes de virarem problema ────
async function runPreditiva(logger) {
  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!chatId) return;

  const memoria = await buildMariahMemoryContext();
  const milestones = getMilestoneContext();
  const privateCtx = await getPrivateContextForAgent('assistente').catch(() => '');

  // Semana à frente
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  const semanaFim = new Date();
  semanaFim.setDate(semanaFim.getDate() + 8);
  let calendarioSemana = '';
  try {
    const eventos = await listarEventos(amanha.toISOString(), semanaFim.toISOString());
    if (eventos.length) {
      calendarioSemana = 'Agenda da semana:\n' + eventos.map(e => `• ${e.summary}`).join('\n');
      if (eventos.length > 6) calendarioSemana += '\n\nATENÇÃO: semana com mais de 6 compromissos — risco de sobrecarga.';
    }
  } catch {}

  const system = `Você é a Mariah, modo PREDITIVA. É domingo à noite. Analise os dados e antecipe os riscos da semana que vem.

Analise:
1. Milestones próximos — o que está em risco pelo tempo restante?
2. Agenda — semana cheia demais? Algum bloqueio de proteção em risco?
3. Padrões de comportamento comercial — o que pode estar atrasando?
4. O que Talita vai precisar antes de precisar pedir?

Formato:
Semana que vem pede:
Risco principal: [o que pode travar]
Ação preventiva: [o que Mariah já vai fazer]
Decisão sua: [só se houver — senão omite]

Sem saudação. Sem emoji. Máximo 120 palavras.
${memoria}
${milestones}`;

  const analise = await callClaude(system, `${calendarioSemana}\n\n${privateCtx.slice(0, 1500)}`, 400);
  await sendTelegramMessage(chatId, analise);
  logger.info('[preditiva] Análise semanal enviada');
}

let _sharedSlackClient = null;

/**
 * Inicializa o scheduler.
 */
function initScheduler(slackClient, logger) {
  _sharedSlackClient = slackClient;

  // ── 8h03 seg-sex — leitura de vendas, caixa, suporte e produto ──
  cron.schedule('3 8 * * 1-5', async () => {
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    logger.info('📊 Cron 8h03 — leitura vendas/caixa/suporte/produto');
    try {
      const memoria = await buildMariahMemoryContext();
      const milestones = getMilestoneContext();
      const system = `Você é a Mariah. São 8h03. Gere uma leitura rápida e direta dos 4 blocos do negócio.
Sem saudação. Sem emoji. Máximo 100 palavras no total.
Formato obrigatório (4 linhas, uma por bloco):
Vendas: [status de leads, pipeline, o que está quente ou parado]
Caixa: [receita confirmada este mês, o que está a vencer, alerta se houver]
Suporte: [status das mentoradas — alguma trava, urgência ou risco de churn]
Produto: [o que está pendente em conteúdo, aula, material — o que Paulo precisa]
Se não há dado concreto num bloco, diga "sem alerta" e siga.
${memoria}
${milestones}`;
      const leitura = await callClaude(system, `Data: ${getBrtDateContext()}`, 300);
      await sendTelegramMessage(chatId, leitura);
    } catch (err) {
      logger.error('[8h03] Erro:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── REATIVA: 8h06 seg-sex — alerta se há algo urgente ──
  cron.schedule('6 8 * * 1-5', async () => {
    logger.info('👁 Cron 8h06 — Mariah REATIVA');
    await runReativa(logger).catch(err => logger.error('[reativa] Erro:', err.message));
  }, { timezone: 'America/Sao_Paulo' });

  // ── 9h00 seg-sex — o que Mariah já identificou e está resolvendo ──
  cron.schedule('0 9 * * 1-5', async () => {
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    logger.info('🔍 Cron 9h00 — Mariah: o que já identifiquei');
    try {
      const memoria = await buildMariahMemoryContext();
      const milestones = getMilestoneContext();
      const system = `Você é a Mariah. São 9h. Liste o que você já identificou e está resolvendo sem a Talita precisar pedir.
Seja específica — não genérica. Se não há nada novo identificado além do que já foi dito no briefing, não mande mensagem (retorne string vazia).
Formato — somente se houver algo concreto:
Eu já:
• [ação concreta que Mariah está tomando — quem acionou, o que vai acontecer]
• ...
Sem emoji. Sem saudação. Máximo 60 palavras.
${memoria}
${milestones}`;
      const acao = await callClaude(system, `Data: ${getBrtDateContext()}`, 200);
      const limpo = acao.trim();
      if (limpo && limpo.length > 10 && !limpo.toLowerCase().includes('string vazia')) {
        await sendTelegramMessage(chatId, limpo);
      }
    } catch (err) {
      logger.error('[9h00] Erro:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── 10h15 seg-sex — check do dia (3 itens fixos) ──
  cron.schedule('15 10 * * 1-5', async () => {
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    logger.info('✅ Cron 10h15 — check do dia');
    try {
      const milestones = getMilestoneContext();
      const now = new Date();
      const dayOfWeek = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' }).format(now);

      const system = `Você é a Mariah. São 10h15. Envie o check do dia — 3 itens que a Talita precisa confirmar que fez ou vai fazer hoje.
Baseie nos 4 focos do negócio e no dia da semana.
Formato obrigatório:
Check do dia:
[ ] [item 1 — ação de venda ou lead]
[ ] [item 2 — conteúdo ou mini aula]
[ ] [item 3 — baseado no milestone mais próximo]
Sem emoji. Sem introdução. Máximo 40 palavras.
${milestones}`;
      const check = await callClaude(system, `Hoje é ${dayOfWeek}. ${getBrtDateContext()}`, 150);
      await sendTelegramMessage(chatId, check);
    } catch (err) {
      logger.error('[check-dia] Erro:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── PROATIVA: quinta 7h30 — dia de gravação ──
  cron.schedule('30 7 * * 4', async () => {
    logger.info('🎬 Cron 7h30 quinta — Mariah PROATIVA: gravação');
    await runProativa('quinta-gravacao', slackClient, logger).catch(err => logger.error('[proativa] Erro:', err.message));
  }, { timezone: 'America/Sao_Paulo' });

  // ── PROATIVA: quarta 9h — check de leads Turma 1 ──
  cron.schedule('0 9 * * 3', async () => {
    logger.info('📞 Cron 9h quarta — Mariah PROATIVA: leads');
    await runProativa('quarta-leads', slackClient, logger).catch(err => logger.error('[proativa] Erro:', err.message));
  }, { timezone: 'America/Sao_Paulo' });

  // ── PREDITIVA: domingo 20h — análise da semana ──
  cron.schedule('0 20 * * 0', async () => {
    logger.info('🔮 Cron 20h domingo — Mariah PREDITIVA');
    await runPreditiva(logger).catch(err => logger.error('[preditiva] Erro:', err.message));
  }, { timezone: 'America/Sao_Paulo' });

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
        text: formatForSlack(`*People* — Pautas quentes de hoje (${new Date().toLocaleDateString('pt-BR')})\n\nUse como repertório, não como texto pronto.\n\n${linhas}\n\nVer todas: https://slack-soab.onrender.com/curadoria`),
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

  // ── 10h toda segunda — Mariah cobra Jay no Telegram: status dos 4 focos ──
  cron.schedule('0 10 * * 1', async () => {
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    logger.info('📋 Cron 10h segunda — Mariah cobra Jay nos 4 focos');
    try {
      const memoria = await buildMariahMemoryContext();
      const contextoPlanejamento = await getPrivateContextForAgent('assistente');

      const system = `Você é a Mariah, agente executiva da Talita.
É segunda-feira, 10h. Jay acabou de rodar o Conselho Estratégico.
Você monitora o progresso de Jay nos 4 focos do negócio.

Os 4 focos são:
1. Evento — captação e venda. Tem data? Oferta estruturada? Roteiro pronto?
2. 3 turmas de 10 pessoas — primeira turma com data? Meta de inscritos em andamento?
3. Mini aulas no Instagram — saindo com frequência? Paulo definiu roteiro?
4. Aula para 2 pessoas — formato e preço definidos?

Gere uma cobrança honesta para a Talita — sem relatório, sem introdução.
Formato:
Jay esta semana: [o que está avançando]
Travado: [o que não andou]
Eu já cobrei: [o que Mariah vai acionar agora]
Depende de você: [só se houver decisão que só Talita toma]
Máximo 80 palavras. Sem saudação. Sem emoji.
${memoria}
${contextoPlanejamento}`;

      const cobranca = await callClaude(system, 'Gere o status de Jay nos 4 focos desta semana.', 300);
      await sendTelegramMessage(chatId, cobranca);
    } catch (err) {
      logger.error('[cobrança-jay] Erro:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });


  // ── 6h30 BRT diário — Nara lê a fila e gera briefing consolidado ──
  cron.schedule('30 6 * * *', async () => {
    logger.info('🧭 Cron 6h30 — Nara gerando briefing de fila');
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
        agent:     AGENTS.nara,
        channel:   CHANNELS.talita,
        maxTokens: 350,
        prompt:    `Nara, briefing de 6h30. Tarefas pendentes na fila:\n${queueSummary}\n\nGere um resumo curto do que o squad precisa resolver hoje. Sem emoji. Formato: Leitura / Risco / Ação. Máximo 90 palavras.`,
      }, slackClient, logger);

    } catch (err) {
      logger.error('Erro no cron 6h30 Nara:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── 7h todo dia — briefing rápido da Mariah no Telegram ──
  cron.schedule('0 7 * * *', async () => {
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    logger.info('🌅 Cron 7h — briefing diário Mariah no Telegram');
    try {
      const memoria = await buildMariahMemoryContext();
      let agendaHoje = '';
      try {
        const brt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const [y, m, d] = brt.split('-');
        const start = new Date(`${y}-${m}-${d}T00:00:00-03:00`);
        const end   = new Date(`${y}-${m}-${d}T23:59:59-03:00`);
        const eventos = await listarEventos(start.toISOString(), end.toISOString());
        if (eventos.length) {
          agendaHoje = '\nAgenda de hoje:\n' + eventos.map(e => `• ${e.summary} — ${e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : 'dia todo'}`).join('\n');
        }
      } catch {}

      const milestones = getMilestoneContext();
      const dayOfWeek = new Date().getDay();
      const temReuniao = agendaHoje.toLowerCase().includes('reunião') || agendaHoje.toLowerCase().includes('cliente') || agendaHoje.toLowerCase().includes('call') || agendaHoje.toLowerCase().includes('evento');
      const temTreino = [1, 3, 5].includes(dayOfWeek); // seg, qua, sex
      const roupaContexto = temReuniao
        ? 'Há reunião ou compromisso externo na agenda — sugestão de roupa: algo que passe autoridade e conforto.'
        : temTreino
          ? 'Dia de treino — roupa leve para academia antes de qualquer compromisso.'
          : 'Sem compromisso externo — pode ir confortável.';

      const system = `Você é a Mariah, agente executiva da Talita. É 7h da manhã.
Envie um briefing diário curto, direto e útil. Sem emoji, sem introdução.
Formato obrigatório:
Hoje pede:
Agenda: (lista os eventos do dia ou "agenda limpa")
Roupa: (1 linha baseada no contexto: ${roupaContexto})
Pendências em aberto: (só as urgentes ou com prazo próximo da memória — máximo 3)
Prazos chegando: (use os PRAZOS DO NEGÓCIO abaixo — mencione só os que estão a menos de 21 dias)
Eu já vou: (o que a Mariah vai fazer sem precisar pedir)
Depende de você: (só se houver decisão real pendente)
${memoria}
${milestones}`;

      const briefing = await callClaude(system, `Gere o briefing de hoje.${agendaHoje}`, 450);
      await sendTelegramMessage(chatId, briefing);
    } catch (err) {
      logger.error('Erro no briefing 7h Mariah:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── 7h toda segunda — manutenção semanal + resumo da semana anterior ──
  cron.schedule('0 7 * * 1', async () => {
    logger.info('🧹 Cron 7h segunda — manutenção semanal da memória da Mariah');
    await manutencaoSemanal();

    // Gatilho 2: resumo da semana anterior
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    try {
      const now = new Date();
      const seg = new Date(now); seg.setDate(now.getDate() - 7); seg.setHours(0, 0, 0, 0);
      const dom = new Date(now); dom.setDate(now.getDate() - 1); dom.setHours(23, 59, 59, 999);
      let eventosStr = '';
      try {
        const eventos = await listarEventos(seg.toISOString(), dom.toISOString());
        eventosStr = eventos.map(e => `• ${e.summary}`).join('\n');
      } catch {}
      const recap = await callClaude(
        'Você é a Mariah. É segunda-feira. Gere um resumo direto da semana anterior para a Talita. Máximo 100 palavras. Sem saudação. Formato: O que aconteceu / O que não andou / O que carrega esta semana.',
        `Eventos da semana:\n${eventosStr || 'sem dados de agenda'}`,
        250
      );
      await sendTelegramMessage(chatId, recap);
    } catch (err) {
      logger.error('[gatilho-recap] Erro:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── 20h todo dia — gatilho 3: reunião sem pauta no dia seguinte ──
  cron.schedule('0 20 * * *', async () => {
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    try {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const brt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(amanha);
      const [y, m, d] = brt.split('-');
      const start = new Date(`${y}-${m}-${d}T00:00:00-03:00`);
      const end   = new Date(`${y}-${m}-${d}T23:59:59-03:00`);
      const eventos = await listarEventos(start.toISOString(), end.toISOString());
      const reunioes = ['reunião', 'reuniao', 'call', 'conversa', 'sessão', 'sessao', 'mentoria', 'meet', 'alinhamento'];
      const semPauta = eventos.filter(e =>
        e.summary && reunioes.some(k => e.summary.toLowerCase().includes(k)) && !e.description?.trim()
      );
      for (const ev of semPauta) {
        const hora = ev.start?.dateTime
          ? new Date(ev.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
          : 'horário a confirmar';
        await sendTelegramMessage(chatId, `Amanhã: ${ev.summary} às ${hora} sem pauta. Preparo ou cancela?`);
      }
    } catch (err) {
      logger.error('[gatilho-pauta] Erro:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── 18h45 toda segunda — cria link Zoom para A Tribus (19h) e manda no Telegram ──
  cron.schedule('45 18 * * 1', async () => {
    logger.info('🎥 Cron 18h45 segunda — criando link Zoom para A Tribus');

    if (!isZoomConfigured()) {
      logger.warn('[zoom] Zoom não configurado — pulando criação de link para A Tribus');
      return;
    }

    try {
      const now = new Date();
      const dataBrt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(now);

      const meeting = await criarReuniaoZoom({
        topic: 'A Tribus — Mentoria',
        startTime: `${dataBrt}T19:00:00`,
        duration: 90,
        agenda: 'Reunião semanal A Tribus',
      });

      const msg = `🎥 *Link Zoom — A Tribus de hoje*\n\n🔗 ${meeting.joinUrl}\n🔑 Senha: ${meeting.password || 'sem senha'}\n📋 ID: \`${meeting.meetingId}\`\n\n_Reunião às 19h. Boa mentoria! 💜_`;

      const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
      if (chatId && process.env.TELEGRAM_BOT_TOKEN) {
        await sendTelegramMessage(chatId, msg);
      }

      logger.info('✅ Link Zoom A Tribus criado e enviado para Talita');
    } catch (err) {
      logger.error('❌ Erro ao criar Zoom para A Tribus:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── 17h30 seg-sex — digest do squad no Telegram ──
  cron.schedule('30 17 * * 1-5', async () => {
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    logger.info('📋 Cron 17h30 — digest do squad para Mariah');
    try {
      const memoria = await buildMariahMemoryContext();
      const milestones = getMilestoneContext();
      const privateCtx = await getPrivateContextForAgent('assistente').catch(() => '');

      const system = `Você é a Mariah. São 17h30. Gere um digest rápido do squad para a Talita — o que deveria ter avançado hoje e o que precisa de atenção amanhã.
Não invente resultados que você não pode confirmar. Use o contexto do negócio, os prazos e a memória.
Sem saudação. Sem emoji. Máximo 120 palavras.
Formato:
Squad hoje:
Jay: [comercial / evento / turmas]
Lia: [leads / pipeline]
People: [conteúdo / mini aulas]
Mari: [CS mentoradas]
Amanhã precisa de você: [só o que é decisão real de Talita — se não houver, omita]
${milestones}
${memoria}`;

      const digest = await callClaude(system, `Gere o digest do squad de hoje. Data: ${getBrtDateContext()}`, 350);
      await sendTelegramMessage(chatId, formatForSlack(digest));
    } catch (err) {
      logger.error('[digest-squad] Erro:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── 8h20 seg/qua/sex — lembrete de treino ──
  cron.schedule('20 8 * * 1,3,5', async () => {
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    await sendTelegramMessage(chatId, 'Treino em 10 minutos.').catch(() => {});
    logger.info('[saude] Lembrete de treino enviado');
  }, { timezone: 'America/Sao_Paulo' });

  // ── 17h toda sexta — fim de expediente, sexta é folga ──
  cron.schedule('0 17 * * 5', async () => {
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    await sendTelegramMessage(chatId, 'Fecha o computador. Sexta é sua.').catch(() => {});
    logger.info('[saude] Lembrete fim de expediente sexta enviado');
  }, { timezone: 'America/Sao_Paulo' });

  // ── 13h seg-sex — pausa e hidratação ──
  cron.schedule('0 13 * * 1-5', async () => {
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (!chatId) return;
    const lembretes = [
      'Bebeu água hoje?',
      'Para 5 minutos antes de continuar.',
      'Almoçou?',
      'Longe da tela por 5 minutos.',
      'Hidratação e respiração antes de voltar.',
    ];
    const msg = lembretes[new Date().getDay() % lembretes.length];
    await sendTelegramMessage(chatId, msg).catch(() => {});
    logger.info('[saude] Lembrete 13h enviado');
  }, { timezone: 'America/Sao_Paulo' });

  // ── 23h30 BRT diário — consolidação da memória da Mariah ──
  cron.schedule('30 23 * * *', async () => {
    logger.info('🧠 Cron 23h30 — consolidação diária da memória da Mariah');
    await consolidarMemoriaDiaria().catch(err => logger.error('[consolidacao-diaria] Erro:', err.message));
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

  logger.info('🗓️ Scheduler iniciado — 6h pautas | 6h30 briefing | 8h rotinas+stories | 8h20 seg/qua/sex treino | 9h30 seg conselho | 10h seg cobrança-jay | 13h pausa | 17h sex fecha-computador | 17h30 digest-squad | 18h45 seg zoom | 20h pauta | 23h30 consolidação-memória | 0h cleanup');
}

module.exports = { initScheduler, runStoriesApprovalRoutine };
