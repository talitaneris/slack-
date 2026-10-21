'use strict';

// Link da bio. 302 (e não 301) para o texto pré-preenchido poder mudar
// sem ficar preso no cache do navegador e do app do Instagram.
const CONTATO_WHATSAPP_URL = 'https://wa.me/5511942811297?text=EU%20QUERO';

function registerContatoRedirect(receiver) {
  // Os dois paths: o Router do Bolt não usa strict routing, mas o par
  // deixa /contato e /contato/ explícitos se isso mudar.
  receiver.router.get(['/contato', '/contato/'], (req, res) => {
    res.redirect(302, CONTATO_WHATSAPP_URL);
  });
}

module.exports = {
  CONTATO_WHATSAPP_URL,
  registerContatoRedirect,
};
