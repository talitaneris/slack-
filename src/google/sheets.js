'use strict';

/**
 * Serviço Google Sheets — grava inscrições da Oficina IA numa planilha.
 *
 * Variáveis de ambiente necessárias:
 *   GOOGLE_CLIENT_ID          — ID do cliente OAuth2 (mesmo do Calendar)
 *   GOOGLE_CLIENT_SECRET      — Secret do cliente OAuth2 (mesmo do Calendar)
 *   GOOGLE_REFRESH_TOKEN      — Token de refresh, autorizado com o escopo spreadsheets
 *   OFICINA_IA_SHEET_ID       — ID da planilha de inscrições
 */

const { google } = require('googleapis');

const SHEET_ID = process.env.OFICINA_IA_SHEET_ID || '1nVkRKx6XbueqomyvpLvLTBYpnvHCNGbq2g2cuNd4w2A';
const SHEET_RANGE = 'A:I';

function getAuth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    console.warn('[sheets] Credenciais Google ausentes.');
    return null;
  }
  const auth = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'https://slack-soab.onrender.com/google/callback'
  );
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return auth;
}

/**
 * Adiciona uma linha na planilha de inscrições da Oficina IA.
 * @param {object} inscricao
 * @param {string} inscricao.nome
 * @param {string} inscricao.email
 * @param {string} inscricao.telefone
 * @param {string} inscricao.negocio
 * @param {string} inscricao.segmento
 * @param {string} inscricao.porte
 * @param {string} inscricao.usaIA
 * @param {string} inscricao.desafio
 */
async function registrarInscricaoOficinaIa(inscricao) {
  const auth = getAuth();
  if (!auth) throw new Error('Google Sheets não configurado (credenciais ausentes).');

  const sheets = google.sheets({ version: 'v4', auth });
  const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        dataHora,
        inscricao.nome || '',
        inscricao.email || '',
        inscricao.telefone || '',
        inscricao.negocio || '',
        inscricao.segmento || '',
        inscricao.porte || '',
        inscricao.usaIA || '',
        inscricao.desafio || '',
      ]],
    },
  });
}

module.exports = { registrarInscricaoOficinaIa };
