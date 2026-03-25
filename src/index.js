require('dotenv').config();

const https = require('https');
const path  = require('path');
const { App, ExpressReceiver } = require('@slack/bolt');
const { handleMention } = require('./handlers/mention');
const { initScheduler } = require('./scheduler/routines');
const { refreshAll, getCache, getPautas, isCacheStale } = require('./curadoria/crawler');
const { registerApprovalHandler } = require('./handlers/approval');
const { registerWebhooks } = require('./webhooks/index');

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
  res.status(200).send('Squad TNeris Bot — online ✅ | /webhook/lead | /webhook/metrics');
});

// Curadoria — site de notícias
receiver.router.get('/curadoria', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/curadoria.html'));
});

// Escritório virtual — visualização dos agentes
receiver.router.get('/escritorio', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/escritorio.html'));
});

receiver.router.get('/curadoria/api', async (req, res) => {
  try {
    if (isCacheStale() || req.query.force) await refreshAll();
    res.json(getCache());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pautas do dia com ângulo de posicionamento (geradas por IA)
receiver.router.get('/curadoria/pautas', async (req, res) => {
  try {
    if (isCacheStale() || req.query.force) await refreshAll();
    res.json({ pautas: getPautas(), lastUpdate: getCache().lastUpdate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// Handler de aprovações no canal #aprovacoes
registerApprovalHandler(app);

// Handler de erros globais
app.error(async (error) => {
  console.error('Erro global no Bolt:', error);
});

// Registra os endpoints de webhook no receiver Express
registerWebhooks(receiver, app.client, console);

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
