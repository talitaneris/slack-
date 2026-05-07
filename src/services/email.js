'use strict';

function cleanEnv(value, fallback = '') {
  return String(value || fallback).trim();
}

const ACCOUNTS_BASE = cleanEnv(process.env.ZOHO_ACCOUNTS_BASE, 'https://accounts.zoho.com');
const MAIL_BASE = cleanEnv(process.env.ZOHO_MAIL_BASE, 'https://mail.zoho.com');

function isEmailConfigured() {
  return !!(
    process.env.ZOHO_OAUTH_CLIENT_ID &&
    process.env.ZOHO_OAUTH_CLIENT_SECRET &&
    process.env.ZOHO_OAUTH_REFRESH_TOKEN
  );
}

function getSinceDate(hours = 14) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function classifyEmail({ from = '', subject = '' }) {
  const text = `${from} ${subject}`.toLowerCase();

  if (/(pagamento|boleto|fatura|invoice|recibo|cobran|venc|charge|payment|cartao|cartão)/i.test(text)) {
    return 'financeiro';
  }

  if (/(lead|proposta|contrato|diagnostico|diagnóstico|call|reuni[aã]o|venda|comercial|mentoria)/i.test(text)) {
    return 'comercial';
  }

  if (/(suporte|problema|erro|acesso|senha|cancel|reembolso|urgent|urgente)/i.test(text)) {
    return 'risco/suporte';
  }

  if (/(newsletter|promo|marketing|no-reply|noreply|notifica|notification)/i.test(text)) {
    return 'baixo impacto';
  }

  return 'triagem';
}

function emailPriority(category, seen) {
  if (category === 'risco/suporte') return 1;
  if (category === 'financeiro') return 2;
  if (category === 'comercial') return 3;
  if (!seen) return 4;
  if (category === 'triagem') return 5;
  return 6;
}

function formatEmailLine(item) {
  const unread = item.seen ? '' : 'nao lido — ';
  return `• ${item.time} — ${unread}${item.category}: ${item.from} | ${item.subject}`;
}

function normalizeZohoList(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.accounts)) return payload.accounts;
  if (Array.isArray(payload?.folders)) return payload.folders;
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload)) return payload;
  return [];
}

function pickAccount(accounts) {
  const preferred = cleanEnv(process.env.ZOHO_MAIL_ACCOUNT_ADDRESS).toLowerCase();
  if (preferred) {
    return accounts.find(account => {
      const address = String(account.mailboxAddress || account.emailAddress || account.primaryEmailAddress || '').toLowerCase();
      return address === preferred;
    }) || accounts[0];
  }

  return accounts.find(account => account.isDefault || account.isPrimary) || accounts[0];
}

function pickInboxFolder(folders) {
  return folders.find(folder => {
    const name = String(folder.folderName || folder.name || '').toLowerCase();
    const type = String(folder.folderType || folder.type || '').toLowerCase();
    return name === 'inbox' || type === 'inbox';
  }) || folders[0];
}

function getAccountId(account) {
  return account?.accountId || account?.id || account?.accountID;
}

function getFolderId(folder) {
  return folder?.folderId || folder?.id || folder?.folderID;
}

function getMessageTime(message) {
  const raw = message.receivedTime || message.receivedtime || message.receivedDate || message.sentDateInGMT || message.sentDate || message.date;
  const millis = Number(raw);
  if (Number.isFinite(millis) && millis > 0) return new Date(millis);
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function getMessageSeen(message) {
  if (typeof message.read === 'boolean') return message.read;
  if (typeof message.isRead === 'boolean') return message.isRead;
  if (typeof message.status === 'string') return message.status.toLowerCase().includes('read');
  return false;
}

async function zohoJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const detail = payload?.message || payload?.error || text || response.statusText;
    throw new Error(`Zoho API ${response.status}: ${detail}`);
  }

  return payload;
}

async function refreshAccessToken() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cleanEnv(process.env.ZOHO_OAUTH_CLIENT_ID),
    client_secret: cleanEnv(process.env.ZOHO_OAUTH_CLIENT_SECRET),
    refresh_token: cleanEnv(process.env.ZOHO_OAUTH_REFRESH_TOKEN),
  });

  const response = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error || payload.message || `Zoho OAuth ${response.status}`);
  }

  return payload.access_token;
}

async function getAccountAndInbox(accessToken) {
  const accountsPayload = await zohoJson(`${MAIL_BASE}/api/accounts`, accessToken);
  const accounts = normalizeZohoList(accountsPayload);
  if (accounts.length === 0) throw new Error('Nenhuma conta Zoho Mail encontrada.');

  const account = pickAccount(accounts);
  const accountId = getAccountId(account);
  if (!accountId) throw new Error('Nao consegui identificar accountId da Zoho.');

  const foldersPayload = await zohoJson(`${MAIL_BASE}/api/accounts/${accountId}/folders`, accessToken);
  const folders = normalizeZohoList(foldersPayload);
  if (folders.length === 0) throw new Error('Nenhuma pasta Zoho Mail encontrada.');

  const inbox = pickInboxFolder(folders);
  const folderId = getFolderId(inbox);
  if (!folderId) throw new Error('Nao consegui identificar folderId da INBOX.');

  return { account, accountId, inbox, folderId };
}

function buildMessagesUrl(accountId, folderId, limit) {
  const params = new URLSearchParams({
    folderId: String(folderId),
    limit: String(Math.max(limit, 25)),
    start: '1',
  });

  return `${MAIL_BASE}/api/accounts/${accountId}/messages/view?${params.toString()}`;
}

async function listarEmailsManha({ limit = 12, hours = 14 } = {}) {
  if (!isEmailConfigured()) {
    return [
      'Zoho Mail API nao configurada.',
      'Faltam variaveis: ZOHO_OAUTH_CLIENT_ID, ZOHO_OAUTH_CLIENT_SECRET e ZOHO_OAUTH_REFRESH_TOKEN.',
    ].join('\n');
  }

  try {
    const accessToken = await refreshAccessToken();
    const { accountId, folderId } = await getAccountAndInbox(accessToken);
    const payload = await zohoJson(buildMessagesUrl(accountId, folderId, limit), accessToken);
    const since = getSinceDate(hours).getTime();

    const messages = normalizeZohoList(payload)
      .map(message => {
        const from = message.fromAddress || message.sender || message.from || message.senderEmailAddress || 'remetente desconhecido';
        const subject = message.subject || '(sem assunto)';
        const category = classifyEmail({ from, subject });
        const date = getMessageTime(message);
        const seen = getMessageSeen(message);
        const time = date.toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });

        return {
          from,
          subject,
          category,
          seen,
          time,
          priority: emailPriority(category, seen),
          date: date.getTime(),
        };
      })
      .filter(message => message.date >= since || !message.seen)
      .sort((a, b) => a.priority - b.priority || b.date - a.date)
      .slice(0, limit);

    if (messages.length === 0) {
      return 'Nenhum e-mail novo/relevante encontrado no periodo analisado.';
    }

    return messages.map(formatEmailLine).join('\n');
  } catch (err) {
    return `Erro ao consultar Zoho Mail API: ${err.message}`;
  }
}

async function enviarEmail({ to, subject, body: bodyText }) {
  if (!isEmailConfigured()) throw new Error('Zoho Mail não configurado');

  const accessToken = await refreshAccessToken();
  const { account, accountId } = await getAccountAndInbox(accessToken);

  const fromAddress =
    account.mailboxAddress ||
    account.emailAddress ||
    account.primaryEmailAddress ||
    cleanEnv(process.env.ZOHO_MAIL_ACCOUNT_ADDRESS);

  const response = await fetch(`${MAIL_BASE}/api/accounts/${accountId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fromAddress,
      toAddress: to,
      subject,
      content: bodyText,
      mailFormat: 'plaintext',
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Zoho send ${response.status}`);
  }

  return data;
}

module.exports = {
  listarEmailsManha,
  isEmailConfigured,
  enviarEmail,
};
