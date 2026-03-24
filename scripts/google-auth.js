/**
 * Script de autorização Google Calendar — rodar UMA VEZ para gerar o refresh_token.
 *
 * Como usar:
 * 1. Preencha CLIENT_ID e CLIENT_SECRET abaixo (do Google Cloud Console)
 * 2. Rode: node scripts/google-auth.js
 * 3. Abra a URL que aparecer no terminal
 * 4. Autorize o acesso à sua conta Google
 * 5. Cole o código que o Google retornar
 * 6. O refresh_token será exibido — copie e adicione no Render como GOOGLE_REFRESH_TOKEN
 */

const { google } = require('googleapis');
const readline   = require('readline');

// ── PREENCHA AQUI ──────────────────────────────────────────
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || 'COLE_AQUI';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'COLE_AQUI';
// ───────────────────────────────────────────────────────────

const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // modo "copy/paste" sem servidor local
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const url = auth.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent', // garante que o refresh_token sempre seja retornado
});

console.log('\n🔗 Abra este link no navegador e autorize o acesso:\n');
console.log(url);
console.log('\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Cole o código de autorização aqui: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await auth.getToken(code.trim());
    console.log('\n✅ Autorizado! Adicione estas variáveis no Render Dashboard:\n');
    console.log(`GOOGLE_CLIENT_ID     = ${CLIENT_ID}`);
    console.log(`GOOGLE_CLIENT_SECRET = ${CLIENT_SECRET}`);
    console.log(`GOOGLE_REFRESH_TOKEN = ${tokens.refresh_token}`);
    console.log('\nOpcional (se não for o calendário principal):');
    console.log(`GOOGLE_CALENDAR_ID   = primary`);
  } catch (err) {
    console.error('\n❌ Erro ao trocar código por token:', err.message);
  }
});
