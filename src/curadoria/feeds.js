// Fontes de RSS por categoria — TNeris Curadoria
// Cada URL fica em uma categoria só. Itens fora do posicionamento saem no filtro.
// Feeds conferidos em 21/10/2026: os que não respondiam XML foram tirados.

const FEEDS = {
  tendencias: {
    label: 'Tendencias',
    sources: [
      { name: 'Think with Google Brasil', url: 'https://www.thinkwithgoogle.com/intl/pt-br/rss.xml', lang: 'pt' },
      { name: 'B9', url: 'https://www.b9.com.br/rss/', lang: 'pt' },
      { name: 'Meio & Mensagem', url: 'https://www.meioemensagem.com.br/comunicacao/feed', lang: 'pt' },
      { name: 'Sprout Social', url: 'https://sproutsocial.com/insights/feed/', lang: 'en' },
    ],
  },

  negocios: {
    label: 'Negocios',
    sources: [
      { name: 'PEGN', url: 'https://revistapegn.globo.com/rss/pegn', lang: 'pt' },
      { name: 'Exame', url: 'https://exame.com/feed/', lang: 'pt' },
      { name: 'Agência Sebrae', url: 'https://agenciasebrae.com.br/feed/', lang: 'pt' },
      { name: 'NeoFeed', url: 'https://neofeed.com.br/feed/', lang: 'pt' },
      { name: 'Folha Mercado', url: 'https://feeds.folha.uol.com.br/mercado/rss091.xml', lang: 'pt' },
      { name: 'Entrepreneur', url: 'https://www.entrepreneur.com/latest.rss', lang: 'en' },
    ],
  },

  marketing_social: {
    label: 'Marketing & Social',
    sources: [
      { name: 'Meio & Mensagem', url: 'https://www.meioemensagem.com.br/marketing/feed', lang: 'pt' },
      { name: 'AdNews', url: 'https://www.adnews.com.br/feed', lang: 'pt' },
      { name: 'RD Station', url: 'https://blog.rdstation.com/feed/', lang: 'pt' },
      { name: 'Rock Content', url: 'https://rockcontent.com/br/blog/feed/', lang: 'pt' },
      { name: 'Social Media Examiner', url: 'https://www.socialmediaexaminer.com/feed/', lang: 'en' },
      { name: 'HubSpot Blog', url: 'https://blog.hubspot.com/marketing/rss.xml', lang: 'en' },
      { name: 'Digiday', url: 'https://digiday.com/feed/', lang: 'en' },
    ],
  },

  comportamento: {
    label: 'Comportamento',
    sources: [
      { name: 'Consumidor Moderno', url: 'https://consumidormoderno.com.br/feed/', lang: 'pt' },
      { name: 'Mercado & Consumo', url: 'https://mercadoeconsumo.com.br/feed/', lang: 'pt' },
      { name: 'Época Negócios', url: 'https://epocanegocios.globo.com/rss/epocanegocios', lang: 'pt' },
      { name: 'Fast Company', url: 'https://www.fastcompany.com/latest/rss', lang: 'en' },
    ],
  },

  algoritmo_ia: {
    label: 'Algoritmo & IA',
    sources: [
      { name: 'Tecnoblog', url: 'https://tecnoblog.net/feed/', lang: 'pt' },
      { name: 'Olhar Digital', url: 'https://olhardigital.com.br/feed/', lang: 'pt' },
      { name: 'Startupi', url: 'https://startupi.com.br/feed/', lang: 'pt' },
      { name: 'Meta Creators', url: 'https://about.fb.com/news/tag/creators/feed/', lang: 'en' },
      { name: 'Meta for Business', url: 'https://www.facebook.com/business/news/rss', lang: 'en' },
    ],
  },

  moda_cultura: {
    label: 'Moda & Cultura',
    sources: [
      { name: 'ELLE Brasil', url: 'https://elle.com.br/feed', lang: 'pt' },
      { name: "Harper's Bazaar", url: 'https://harpersbazaar.uol.com.br/feed/', lang: 'pt' },
      { name: 'WWD', url: 'https://wwd.com/feed/', lang: 'en' },
    ],
  },

  campanhas: {
    label: 'Campanhas',
    sources: [
      { name: 'Propmark', url: 'https://propmark.com.br/feed/', lang: 'pt' },
      { name: 'GKPB', url: 'https://gkpb.com.br/feed/', lang: 'pt' },
      { name: 'Adweek', url: 'https://www.adweek.com/feed/', lang: 'en' },
      { name: 'Marketing Dive', url: 'https://www.marketingdive.com/feeds/news/', lang: 'en' },
    ],
  },
};

// Quem fica com a notícia quando dois veículos contam a mesma história.
const DEDUPE_PRIORITY = [
  'marketing_social',
  'campanhas',
  'algoritmo_ia',
  'negocios',
  'tendencias',
  'comportamento',
  'moda_cultura',
];

module.exports = { FEEDS, DEDUPE_PRIORITY };
