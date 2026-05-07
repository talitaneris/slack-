'use strict';

const { ImapFlow } = require('imapflow');

function cleanEnv(value, fallback = '') {
  return String(value || fallback).trim();
}

function isEmailConfigured() {
  return !!(
    process.env.ZOHO_EMAIL_USER &&
    process.env.ZOHO_EMAIL_PASSWORD
  );
}

function getEmailClient() {
  return new ImapFlow({
    host: cleanEnv(process.env.ZOHO_IMAP_HOST, 'imap.zoho.com'),
    port: Number(cleanEnv(process.env.ZOHO_IMAP_PORT, '993')),
    secure: cleanEnv(process.env.ZOHO_IMAP_SECURE, 'true') !== 'false',
    auth: {
      user: cleanEnv(process.env.ZOHO_EMAIL_USER),
      pass: cleanEnv(process.env.ZOHO_EMAIL_PASSWORD),
    },
    logger: false,
  });
}

function getSinceDate(hours = 14) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function formatAddress(address = {}) {
  const name = address.name || '';
  const addr = address.address || '';
  if (name && addr) return `${name} <${addr}>`;
  return name || addr || 'remetente desconhecido';
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

async function listarEmailsManha({ limit = 12, hours = 14 } = {}) {
  if (!isEmailConfigured()) {
    return [
      'Zoho Mail nao configurado.',
      'Faltam variaveis: ZOHO_EMAIL_USER e ZOHO_EMAIL_PASSWORD.',
      'Opcional: ZOHO_IMAP_HOST=imap.zoho.com, ZOHO_IMAP_PORT=993.',
    ].join('\n');
  }

  const client = getEmailClient();
  const since = getSinceDate(hours);

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const messages = [];
      const uids = await client.search({ since });

      if (!uids || uids.length === 0) {
        return 'Nenhum e-mail novo/relevante encontrado no periodo analisado.';
      }

      for await (const msg of client.fetch(uids, {
        envelope: true,
        flags: true,
        internalDate: true,
      }, { uid: true })) {
        const from = formatAddress(msg.envelope?.from?.[0]);
        const subject = msg.envelope?.subject || '(sem assunto)';
        const category = classifyEmail({ from, subject });
        const seen = Array.from(msg.flags || []).includes('\\Seen');
        const date = msg.internalDate || msg.envelope?.date || new Date();
        const time = new Date(date).toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });

        messages.push({
          from,
          subject,
          category,
          seen,
          time,
          priority: emailPriority(category, seen),
          date: new Date(date).getTime(),
        });
      }

      if (messages.length === 0) {
        return 'Nenhum e-mail novo/relevante encontrado no periodo analisado.';
      }

      return messages
        .sort((a, b) => a.priority - b.priority || b.date - a.date)
        .slice(0, limit)
        .map(formatEmailLine)
        .join('\n');
    } finally {
      lock.release();
    }
  } catch (err) {
    return `Erro ao consultar Zoho Mail: ${err.message}`;
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignora erro de logout para nao quebrar rotina.
    }
  }
}

module.exports = {
  listarEmailsManha,
  isEmailConfigured,
};
