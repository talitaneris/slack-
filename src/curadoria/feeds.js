// Fontes de RSS por categoria para a curadoria TNeris

const FEEDS = {
  marketing: {
    label: 'Marketing',
    icon: '📣',
    color: '#5B88B2',
    sources: [
      { name: 'Neil Patel',              url: 'https://neilpatel.com/feed/' },
      { name: 'HubSpot Blog',            url: 'https://blog.hubspot.com/marketing/rss.xml' },
      { name: 'Content Marketing Inst.', url: 'https://contentmarketinginstitute.com/feed/' },
      { name: 'Marketing Dive',          url: 'https://www.marketingdive.com/feeds/news/' },
      { name: 'Meio & Mensagem',         url: 'https://meioemensagem.com.br/feed/' },
      { name: 'AdNews',                  url: 'https://www.adnews.com.br/feed' },
    ],
  },

  negocios: {
    label: 'Negócios',
    icon: '💼',
    color: '#4CAF50',
    sources: [
      { name: 'Exame',                url: 'https://exame.com/feed/' },
      { name: 'InfoMoney',            url: 'https://www.infomoney.com.br/feed/' },
      { name: 'Startupi',             url: 'https://startupi.com.br/feed/' },
      { name: 'Fast Company',         url: 'https://www.fastcompany.com/latest/rss' },
      { name: 'Entrepreneur',         url: 'https://www.entrepreneur.com/latest.rss' },
      { name: 'Pequenas Empresas',    url: 'https://revistapegn.globo.com/api/feed/rss' },
    ],
  },

  tech_ia: {
    label: 'Tech & IA',
    icon: '🤖',
    color: '#9C27B0',
    sources: [
      { name: 'TechCrunch',       url: 'https://techcrunch.com/feed/' },
      { name: 'VentureBeat AI',   url: 'https://venturebeat.com/category/ai/feed/' },
      { name: 'Tecnoblog',        url: 'https://tecnoblog.net/feed/' },
      { name: 'Olhar Digital',    url: 'https://olhardigital.com.br/feed/' },
      { name: 'MIT Tech Review',  url: 'https://www.technologyreview.com/stories.rss' },
      { name: 'The Verge',        url: 'https://www.theverge.com/rss/index.xml' },
    ],
  },

  moda: {
    label: 'Moda & Tendências',
    icon: '✨',
    color: '#E91E63',
    sources: [
      { name: 'Business of Fashion', url: 'https://www.businessoffashion.com/feed' },
      { name: 'WWD',                 url: 'https://wwd.com/feed/' },
      { name: 'GKPB',               url: 'https://gkpb.com.br/feed/' },
      { name: 'Glamour BR',         url: 'https://glamouronline.com.br/feed/' },
      { name: 'Wired',              url: 'https://www.wired.com/feed/rss' },
    ],
  },

  tneris: {
    label: 'TNeris',
    icon: '⚡',
    color: '#FBF9E4',
    sources: [
      { name: 'Harvard Business Review', url: 'https://feeds.hbr.org/harvardbusiness' },
      { name: 'Inc.',                    url: 'https://www.inc.com/rss' },
      { name: 'Forbes Entrepreneurs',    url: 'https://www.forbes.com/entrepreneurs/feed2/' },
      { name: 'Você S/A',               url: 'https://vocesa.abril.com.br/feed/' },
      { name: 'Social Media Examiner',   url: 'https://www.socialmediaexaminer.com/feed/' },
    ],
  },
};

module.exports = { FEEDS };
