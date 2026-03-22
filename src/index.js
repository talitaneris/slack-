require('dotenv').config();

const { App } = require('@slack/bolt');
const { handleMention } = require('./handlers/mention');
const { initScheduler } = require('./scheduler/routines');

// Validação das variáveis de ambiente obrigatórias
const REQUIRED_ENV = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'ANTHROPIC_API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Variável de ambiente obrigatória ausente: ${key}`);
    process.exit(1);
  }
}

// Inicializa o app do Slack com Bolt (modo HTTP)
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // processBeforeResponse: false (padrão) — responde 200 imediatamente e processa async
});

// Handler para menções ao bot (@Squad TNeris Bot Jay, ...)
app.event('app_mention', async ({ event, client, logger }) => {
  await handleMention({ event, client, logger });
});

// Handler de erros globais
app.error(async (error) => {
  console.error('Erro global no Bolt:', error);
});

// Inicia o servidor
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);

  console.log(`⚡ Squad TNeris Bot rodando na porta ${port}`);
  console.log('👥 Agentes: Lua, Jay, Sofia, Mari, Lia, Marta, Vega, People, Alex, Paulo, Lens, Assistente');

  // Inicia o scheduler de rotinas diárias
  initScheduler(app.client, console);
})();
