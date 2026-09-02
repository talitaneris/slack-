'use strict';

const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/spreadsheets',
];

function getRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;

  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${proto}://${host}/google/callback`;
}

function getOAuthClient(req) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;

  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    getRedirectUri(req)
  );
}

function renderHtml(title, body) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; line-height: 1.5; color: #1f1f1f; }
    code, pre { background: #f4f4f4; border-radius: 8px; }
    code { padding: 2px 6px; }
    pre { padding: 16px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    a { color: #2557d6; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

function registerGoogleOAuth(receiver, logger = console) {
  receiver.router.get('/google/auth', (req, res) => {
    const auth = getOAuthClient(req);
    if (!auth) {
      return res.status(400).send(renderHtml(
        'Google Calendar nao configurado',
        '<p>Adicione <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> no Render antes de autorizar.</p>'
      ));
    }

    const state = process.env.GOOGLE_OAUTH_STATE || 'tneris';
    const url = auth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state,
    });

    res.redirect(url);
  });

  receiver.router.get('/google/callback', async (req, res) => {
    const expectedState = process.env.GOOGLE_OAUTH_STATE || 'tneris';
    if (req.query.state !== expectedState) {
      return res.status(401).send(renderHtml('Autorizacao invalida', '<p>State do Google OAuth nao confere.</p>'));
    }

    if (req.query.error) {
      return res.status(400).send(renderHtml('Google recusou autorizacao', `<pre>${String(req.query.error)}</pre>`));
    }

    const code = req.query.code;
    if (!code) {
      return res.status(400).send(renderHtml('Codigo ausente', '<p>O Google nao retornou o codigo de autorizacao.</p>'));
    }

    const auth = getOAuthClient(req);
    if (!auth) {
      return res.status(400).send(renderHtml('Google Calendar nao configurado', '<p>Credenciais ausentes.</p>'));
    }

    try {
      const { tokens } = await auth.getToken(code);
      if (!tokens.refresh_token) {
        return res.status(400).send(renderHtml(
          'Refresh token nao retornou',
          '<p>Tente novamente em <code>/google/auth</code>. Se ja autorizou antes, revogue o acesso do app na sua Conta Google e autorize de novo.</p>'
        ));
      }

      res.send(renderHtml(
        'Google autorizado — Calendar + YouTube + Sheets',
        `<p>Copie estes valores para o Render:</p>
<pre>GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}
GOOGLE_CALENDAR_ID=primary
YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}</pre>
<p><strong>O mesmo token cobre Calendar, YouTube e Sheets.</strong> Salve os três e faca redeploy.</p>`
      ));
    } catch (err) {
      logger.error('Erro no callback Google OAuth:', err.message);
      res.status(500).send(renderHtml('Erro ao gerar token', `<pre>${err.message}</pre>`));
    }
  });

  logger.info('Google OAuth registrado: /google/auth | /google/callback');
}

module.exports = { registerGoogleOAuth };
