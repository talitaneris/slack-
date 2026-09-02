'use strict';

const querystring = require('querystring');
const { registrarInscricaoOficinaIa } = require('../google/sheets');

const WHATSAPP_URL = 'https://wa.me/5513981272062?text=Oi%20acabei%20de%20me%20inscrever%20na%20oficina%20de%20IA.';

function readFormBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(querystring.parse(data)));
    req.on('error', reject);
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pageShell(title, bodyHtml) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap">
<style>
  :root {
    --ink: #141210;
    --paper: #f6f3ec;
    --paper-dim: #efeadf;
    --burgundy: #6b1f2a;
    --moss: #2f5b3f;
    --line: rgba(20,18,16,.12);
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:"IBM Plex Sans",system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  .shell { max-width:640px; margin:0 auto; padding:56px clamp(20px,4vw,40px) 80px; }
  .eyebrow { display:flex; align-items:center; gap:10px; font-family:"IBM Plex Mono",monospace; font-size:.75rem; letter-spacing:.11em; text-transform:uppercase; color:var(--burgundy); font-weight:600; margin:0 0 18px; }
  h1 { font-family:"DM Serif Display",Georgia,serif; font-weight:400; font-size:clamp(2rem,5vw,2.8rem); line-height:1.05; margin:0 0 14px; letter-spacing:-.02em; }
  h1 em { font-style:italic; color:var(--burgundy); }
  p.lede { font-size:.9375rem; color:rgba(20,18,16,.72); line-height:1.6; margin:0 0 36px; }
  label { display:block; font-family:"IBM Plex Mono",monospace; font-size:.7rem; letter-spacing:.08em; text-transform:uppercase; color:rgba(20,18,16,.6); margin:0 0 8px; }
  .field { margin-bottom:22px; }
  input, select, textarea {
    width:100%; font-family:"IBM Plex Sans",sans-serif; font-size:.9375rem; color:var(--ink);
    background:var(--paper-dim); border:1px solid var(--line); border-radius:8px; padding:13px 14px;
  }
  textarea { min-height:96px; resize:vertical; }
  input:focus, select:focus, textarea:focus { outline:2px solid var(--moss); outline-offset:1px; }
  .primary-cta {
    display:inline-flex; align-items:center; gap:10px; background:var(--moss); color:var(--paper);
    padding:15px 26px; border-radius:999px; border:none; cursor:pointer;
    font-family:"IBM Plex Mono",monospace; font-weight:600; font-size:.6875rem; letter-spacing:.14em; text-transform:uppercase;
  }
  .primary-cta:hover { background:#24462f; }
  .error { background:#f8e5e5; border:1px solid #d9a3a3; color:#7a1f1f; border-radius:8px; padding:14px 16px; font-size:.85rem; margin-bottom:24px; }
  .confirm-card { background:var(--ink); color:var(--paper); border-radius:20px; padding:40px clamp(24px,5vw,48px); }
  .confirm-card .eyebrow { color:#cfa9ae; }
  .confirm-card h1 { color:var(--paper); }
  .confirm-card p { color:rgba(246,243,236,.78); line-height:1.6; font-size:.9375rem; }
  .confirm-facts { border-top:1px solid rgba(255,250,245,.15); margin-top:24px; padding-top:20px; display:flex; flex-direction:column; gap:10px; font-family:"IBM Plex Mono",monospace; font-size:.75rem; letter-spacing:.06em; text-transform:uppercase; color:rgba(246,243,236,.85); }
  .confirm-facts .confirm-address { text-transform:none; letter-spacing:normal; line-height:1.5; }
  .whatsapp-link { display:inline-flex; align-items:center; gap:8px; margin-top:28px; color:var(--paper); border-bottom:1px solid rgba(255,250,245,.4); padding-bottom:2px; text-decoration:none; font-family:"IBM Plex Mono",monospace; font-size:.75rem; letter-spacing:.1em; text-transform:uppercase; }
</style>
</head>
<body>
  <div class="shell">${bodyHtml}</div>
</body>
</html>`;
}

function formPage({ error } = {}) {
  const errorHtml = error ? `<div class="error">${escapeHtml(error)}</div>` : '';
  return pageShell('Inscrição — Oficina IA na Prática para Negócios', `
    <p class="eyebrow">Quase lá</p>
    <h1>Antes do dia 26,<br><em>queremos te conhecer.</em></h1>
    <p class="lede">Sua vaga está garantida. Preencha esses dados rápidos pra gente já chegar no dia da oficina sabendo mais sobre você e o seu negócio.</p>
    ${errorHtml}
    <form method="POST" action="/oficina-ia/inscricao">
      <div class="field"><label for="nome">Nome completo</label><input id="nome" name="nome" type="text" required></div>
      <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" required></div>
      <div class="field"><label for="telefone">Telefone / WhatsApp</label><input id="telefone" name="telefone" type="tel" required></div>
      <div class="field"><label for="negocio">Nome do negócio</label><input id="negocio" name="negocio" type="text" required></div>
      <div class="field"><label for="segmento">Segmento do negócio</label><input id="segmento" name="segmento" type="text" placeholder="Ex: transporte, moda, consultoria, estética, serviços..." required></div>
      <div class="field"><label for="instagram">Instagram do negócio</label><input id="instagram" name="instagram" type="text" placeholder="@seuusuario"></div>
      <div class="field">
        <label for="equipe">Tamanho da equipe</label>
        <select id="equipe" name="equipe" required>
          <option value="">Selecione</option>
          <option value="Só eu (autônoma/o)">Só eu (autônoma/o)</option>
          <option value="2 a 5 pessoas">2 a 5 pessoas</option>
          <option value="6 a 15 pessoas">6 a 15 pessoas</option>
          <option value="Mais de 15 pessoas">Mais de 15 pessoas</option>
        </select>
      </div>
      <div class="field">
        <label for="faturamento">Faturamento aproximado (mensal)</label>
        <select id="faturamento" name="faturamento" required>
          <option value="">Selecione</option>
          <option value="De R$ 10 mil a R$ 30 mil">De R$ 10 mil a R$ 30 mil</option>
          <option value="De R$ 30 mil a R$ 100 mil">De R$ 30 mil a R$ 100 mil</option>
          <option value="De R$ 100 mil a R$ 300 mil">De R$ 100 mil a R$ 300 mil</option>
          <option value="Acima de R$ 500 mil">Acima de R$ 500 mil</option>
          <option value="Prefiro não informar">Prefiro não informar</option>
        </select>
      </div>
      <div class="field">
        <label for="usaIA">Já usa IA no negócio?</label>
        <select id="usaIA" name="usaIA" required>
          <option value="">Selecione</option>
          <option value="Não uso ainda">Não uso ainda</option>
          <option value="Já tentei e não gostei do resultado">Já tentei e não gostei do resultado</option>
          <option value="Uso, mas de forma bem básica">Uso, mas de forma bem básica</option>
          <option value="Uso bastante e quero aprofundar">Uso bastante e quero aprofundar</option>
        </select>
      </div>
      <div class="field"><label for="desafio">Principal desafio na implementação de IA no negócio</label><textarea id="desafio" name="desafio" required></textarea></div>
      <button class="primary-cta" type="submit">Confirmar inscrição</button>
    </form>
  `);
}

function confirmationPage({ nome }) {
  const primeiroNome = String(nome || '').trim().split(/\s+/)[0] || '';
  return pageShell('Inscrição confirmada — Oficina IA', `
    <div class="confirm-card">
      <p class="eyebrow">Inscrição confirmada</p>
      <h1>${primeiroNome ? `${escapeHtml(primeiroNome)}, ` : ''}nos vemos<br><em>dia 26 de setembro.</em></h1>
      <p>Recebemos seus dados. Guarde o endereço abaixo — mais detalhes práticos do dia chegam por e-mail e WhatsApp nos próximos dias.</p>
      <div class="confirm-facts">
        <span>Data — 26/09/2026</span>
        <span>Horário — 10h às 18h</span>
        <span>Formato — Presencial</span>
        <span>Local — Empresarial Monte Carlo, Alphaville</span>
        <span class="confirm-address">Endereço — Av. Ipanema, 165 - Empresarial 18 do Forte, Barueri - SP, CEP 06472-002</span>
      </div>
      <a class="whatsapp-link" href="${WHATSAPP_URL}" target="_blank" rel="noreferrer">Falar no WhatsApp ↗</a>
    </div>
  `);
}

function registerOficinaIaInscricao(receiver, logger = console) {
  receiver.router.get('/oficina-ia/inscricao', (req, res) => {
    res.send(formPage());
  });

  receiver.router.post('/oficina-ia/inscricao', async (req, res) => {
    try {
      const body = await readFormBody(req);
      const { nome, email, telefone, negocio, segmento, instagram, equipe, faturamento, usaIA, desafio } = body;

      if (!nome || !email || !telefone || !negocio || !segmento || !equipe || !faturamento || !usaIA || !desafio) {
        return res.status(400).send(formPage({ error: 'Preencha todos os campos antes de enviar.' }));
      }

      await registrarInscricaoOficinaIa({ nome, email, telefone, negocio, segmento, instagram, equipe, faturamento, usaIA, desafio });
      res.send(confirmationPage({ nome }));
    } catch (err) {
      logger.error('Erro ao registrar inscrição da Oficina IA:', err.message);
      res.status(500).send(formPage({ error: 'Não conseguimos salvar sua inscrição agora. Tente de novo em alguns minutos ou fale no WhatsApp.' }));
    }
  });

  logger.info('Inscrição Oficina IA registrada: GET/POST /oficina-ia/inscricao');
}

module.exports = { registerOficinaIaInscricao };
