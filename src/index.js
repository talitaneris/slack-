require('dotenv').config();

const https = require('https');
const { App, ExpressReceiver } = require('@slack/bolt');
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

// Receiver customizado para adicionar rotas extras ao Express
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Health check — Render usa essa rota para verificar se o serviço está vivo
receiver.router.get('/', (req, res) => {
  res.status(200).send('Squad TNeris Bot — online ✅');
});

// Inicializa o app do Slack com Bolt
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Handler para menções ao bot (@Squad TNeris Bot Jay, ...)
app.event('app_mention', async ({ event, client, logger }) => {
  await handleMention({ event, client, logger });
});

// Handler de erros globais
app.error(async (error) => {
  console.error('Erro global no Bolt:', error);
});

// Keep-alive: pinga o próprio serviço a cada 14 min para não hibernar no Render free
function startKeepAlive(hostname) {
  const url = `https://${hostname}`;
  setInterval(() => {
    https.get(url, (res) => {
      console.log(`🏓 Keep-alive OK (${res.statusCode})`);
    }).on('error', (err) => {
      console.warn(`⚠️  Keep-alive falhou: ${err.message}`);
    });
  }, 14 * 60 * 1000); // 14 minutos
  console.log(`🏓 Keep-alive iniciado → ${url}`);
}

// Inicia o servidor
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);

  console.log(`⚡ Squad TNeris Bot rodando na porta ${port}`);
  console.log('👥 Agentes: Lua, Jay, Sofia, Mari, Lia, Marta, Vega, People, Alex, Paulo, Lens, Assistente');

  // Render injeta RENDER_EXTERNAL_HOSTNAME automaticamente na URL pública do serviço
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    startKeepAlive(process.env.RENDER_EXTERNAL_HOSTNAME);
  }

  // Inicia o scheduler de rotinas diárias (8h BRT)
  initScheduler(app.client, console);
})();
