// Fontes de RSS por categoria — TNeris Curadoria
// Portais de primeira mao + fontes curadas para o posicionamento da Talita

const FEEDS = {
  tendencias: {
    label: 'Tendencias',
    sources: [
      { name: 'Google Trends Brasil',       url: 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=BR' },
      { name: 'Reddit Empreendedorismo',    url: 'https://www.reddit.com/r/empreendedorismo/.rss' },
      { name: 'Reddit Marketing',           url: 'https://www.reddit.com/r/marketing/top.rss?t=day' },
      { name: 'Reddit Brasil',              url: 'https://www.reddit.com/r/brasil/top.rss?t=day' },
      { name: 'Reddit Pequenos Negocios',   url: 'https://www.reddit.com/r/smallbusiness/top.rss?t=day' },
      { name: 'TikTok Newsroom',            url: 'https://newsroom.tiktok.com/en-us/rss' },
      { name: 'Social Media Today',         url: 'https://www.socialmediatoday.com/rss.xml' },
      { name: 'Axios',                      url: 'https://api.axios.com/feed/' },
    ],
  },

  negocios: {
    label: 'Negocios',
    sources: [
      // Brasil — primeira mao
      { name: 'Folha de S.Paulo',           url: 'https://feeds.folha.uol.com.br/mercado/rss091.xml' },
      { name: 'Estadao Economia',           url: 'https://economia.estadao.com.br/rss11,0,0,0,0,0.xml' },
      { name: 'O Globo Economia',           url: 'https://oglobo.globo.com/rss.xml?secao=economia' },
      { name: 'Valor Economico',            url: 'https://valor.globo.com/rss' },
      { name: 'CNN Brasil Negocios',        url: 'https://www.cnnbrasil.com.br/feed/' },
      { name: 'Veja Negocios',              url: 'https://veja.abril.com.br/feed/' },
      { name: 'Exame',                      url: 'https://exame.com/feed/' },
      { name: 'InfoMoney',                  url: 'https://www.infomoney.com.br/feed/' },
      { name: 'Pequenas Empresas',          url: 'https://revistapegn.globo.com/api/feed/rss' },
      { name: 'Startupi',                   url: 'https://startupi.com.br/feed/' },
      { name: 'Sebrae',                     url: 'https://agenciasebrae.com.br/feed/' },
      // Internacional — primeira mao
      { name: 'Reuters Business',           url: 'https://feeds.reuters.com/reuters/businessNews' },
      { name: 'Bloomberg Markets',          url: 'https://feeds.bloomberg.com/markets/news.rss' },
      { name: 'Financial Times',            url: 'https://www.ft.com/rss/home/us' },
      { name: 'WSJ Markets',               url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml' },
      { name: 'AP Business',               url: 'https://rsshub.app/apnews/topics/business-news' },
      // Empreendedorismo de referencia
      { name: 'Inc.',                       url: 'https://www.inc.com/rss' },
      { name: 'Entrepreneur',              url: 'https://www.entrepreneur.com/latest.rss' },
      { name: 'Fast Company',              url: 'https://www.fastcompany.com/latest/rss' },
      { name: 'Forbes Entrepreneurs',      url: 'https://www.forbes.com/entrepreneurs/feed2/' },
      { name: 'Harvard Business Review',   url: 'https://feeds.hbr.org/harvardbusiness' },
    ],
  },

  marketing_social: {
    label: 'Marketing & Social',
    sources: [
      // Autoridade internacional
      { name: 'AdWeek',                    url: 'https://www.adweek.com/feed/' },
      { name: 'Ad Age',                    url: 'https://adage.com/rss' },
      { name: 'Digiday',                   url: 'https://digiday.com/feed/' },
      { name: 'The Drum',                  url: 'https://www.thedrum.com/rss' },
      { name: 'Campaign US',               url: 'https://www.campaignlive.com/rss' },
      // Social media especifico
      { name: 'Social Media Examiner',     url: 'https://www.socialmediaexaminer.com/feed/' },
      { name: 'Later Blog',                url: 'https://later.com/blog/feed/' },
      { name: 'Sprout Social',             url: 'https://sproutsocial.com/insights/feed/' },
      { name: 'HubSpot Blog',              url: 'https://blog.hubspot.com/marketing/rss.xml' },
      { name: 'Neil Patel',                url: 'https://neilpatel.com/feed/' },
      { name: 'Content Marketing Inst.',   url: 'https://contentmarketinginstitute.com/feed/' },
      // Brasil
      { name: 'Meio & Mensagem',           url: 'https://meioemensagem.com.br/feed/' },
      { name: 'AdNews',                    url: 'https://www.adnews.com.br/feed' },
      { name: 'Marketing Dive',            url: 'https://www.marketingdive.com/feeds/news/' },
    ],
  },

  comportamento: {
    label: 'Comportamento',
    sources: [
      { name: 'Think with Google',         url: 'https://www.thinkwithgoogle.com/rss/' },
      { name: 'Harvard Business Review',   url: 'https://feeds.hbr.org/harvardbusiness' },
      { name: 'Wired Business',            url: 'https://www.wired.com/feed/category/business/latest/rss' },
      { name: 'Fast Company',              url: 'https://www.fastcompany.com/90930521/rss' },
      { name: 'MIT Tech Review',           url: 'https://www.technologyreview.com/stories.rss' },
      { name: 'Axios',                     url: 'https://api.axios.com/feed/' },
      { name: 'Voce S/A',                  url: 'https://vocesa.abril.com.br/feed/' },
      { name: 'Nielsen Insights',          url: 'https://www.nielsen.com/insights/feed/' },
    ],
  },

  algoritmo_ia: {
    label: 'Algoritmo & IA',
    sources: [
      // Primeira mao tech
      { name: 'The Information',           url: 'https://www.theinformation.com/feed' },
      { name: 'TechCrunch',                url: 'https://techcrunch.com/feed/' },
      { name: 'The Verge',                 url: 'https://www.theverge.com/rss/index.xml' },
      { name: 'Wired',                     url: 'https://www.wired.com/feed/rss' },
      { name: 'VentureBeat AI',            url: 'https://venturebeat.com/category/ai/feed/' },
      { name: 'MIT Tech Review',           url: 'https://www.technologyreview.com/stories.rss' },
      // Brasil tech
      { name: 'Tecnoblog',                 url: 'https://tecnoblog.net/feed/' },
      { name: 'Olhar Digital',             url: 'https://olhardigital.com.br/feed/' },
      // IA aplicada a marketing
      { name: 'Social Media Examiner AI',  url: 'https://www.socialmediaexaminer.com/category/artificial-intelligence/feed/' },
      { name: 'Digiday AI',                url: 'https://digiday.com/tag/artificial-intelligence/feed/' },
    ],
  },

  moda_cultura: {
    label: 'Moda & Cultura',
    sources: [
      { name: 'Business of Fashion',       url: 'https://www.businessoffashion.com/feed' },
      { name: 'WWD',                       url: 'https://wwd.com/feed/' },
      { name: 'Vogue Business',            url: 'https://www.voguebusiness.com/rss' },
      { name: 'GKPB',                      url: 'https://gkpb.com.br/feed/' },
      { name: 'Vogue Brasil',              url: 'https://vogue.globo.com/rss' },
      { name: 'Wired Culture',             url: 'https://www.wired.com/feed/category/culture/latest/rss' },
    ],
  },

  campanhas: {
    label: 'Campanhas',
    sources: [
      { name: 'AdWeek',                    url: 'https://www.adweek.com/feed/' },
      { name: 'Ad Age',                    url: 'https://adage.com/rss' },
      { name: 'The Drum',                  url: 'https://www.thedrum.com/rss' },
      { name: 'Digiday',                   url: 'https://digiday.com/feed/' },
      { name: 'Meio & Mensagem',           url: 'https://meioemensagem.com.br/feed/' },
      { name: 'AdNews',                    url: 'https://www.adnews.com.br/feed' },
      { name: 'GKPB',                      url: 'https://gkpb.com.br/feed/' },
      { name: 'Campaign US',               url: 'https://www.campaignlive.com/rss' },
    ],
  },
};

module.exports = { FEEDS };
