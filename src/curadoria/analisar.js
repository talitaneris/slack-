// Análise de IA das notícias do dia — gera pautas quentes com ângulo de posicionamento da Talita

const { callClaude } = require('../claude');

const SYSTEM_ANALISAR = `
Você é um estrategista de conteúdo da Talita Neris — estrategista de crescimento de negócios para empreendedoras digitais.

POSICIONAMENTO:
Talita não é especialista em Instagram, não é coach de comunicação, não é professora de marketing.
Ela é estrategista de crescimento de negócios. Tese: "Crescimento é extrair o que já existe — não fazer mais."
ICP: empreendedora digital, 25–45 anos, negócio ativo com faturamento mas sem crescimento proporcional ao esforço.

FUNÇÃO:
Analisar notícias e tendências do dia e identificar as pautas mais relevantes para o ICP da Talita.
Para cada pauta: dizer por que o ICP se importa, qual o ângulo de posicionamento da Talita, e sugerir um hook direto.

REGRAS DE VOZ (inegociável):
— Nenhuma palavra proibida: transformação, jornada, empoderar, audiência, engajamento, presença digital, receita real, real (adjetivo), estrutura (em copy), sinergia, inovador, holístico, robusto, mindset, ecossistema, catalisador, tração, visibilidade (como objetivo), potencializar, próximo nível, sua melhor versão
— Sem frases de transição de IA: "É importante destacar", "Vale ressaltar", "Em suma", "Portanto", "Além disso"
— Hook: diagnóstico direto ou inversão. Nunca pergunta motivacional. Nunca começa com saudação.
— Específico bate genérico: nomeia a dor exata, não a categoria da dor
`.trim();

async function gerarPautas(articles) {
  if (!articles || articles.length === 0) return [];

  // Pega os 30 mais recentes de todas as categorias
  const todos = articles
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30);

  const lista = todos
    .map((a, i) => `${i + 1}. [${a.source}] ${a.title}\n   ${a.summary || ''}`)
    .join('\n\n');

  const prompt = `
Aqui estão as notícias e tendências do dia (${new Date().toLocaleDateString('pt-BR')}):

${lista}

Selecione as 5 pautas mais relevantes para o ICP da Talita Neris (empreendedoras com negócio ativo mas crescimento travado).

Para cada pauta, entregue exatamente neste formato JSON (array de 5 objetos):

[
  {
    "titulo": "título direto da pauta (não o título do artigo — o ângulo para o ICP)",
    "fonte": "nome da fonte original",
    "relevancia": "por que o ICP da Talita se importa com isso (1 frase, específica)",
    "angulo": "como Talita se posiciona sobre esse tema (1-2 frases, na voz dela)",
    "hook": "hook pronto para Stories ou Reel (1-2 frases, diagnóstico direto ou inversão, nunca pergunta motivacional)"
  }
]

Responda SOMENTE com o JSON. Sem texto antes ou depois.
`.trim();

  try {
    const raw = await callClaude(SYSTEM_ANALISAR, prompt, 1000);
    // Extrai JSON da resposta
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('❌ Erro ao gerar pautas:', err.message);
    return [];
  }
}

module.exports = { gerarPautas };
