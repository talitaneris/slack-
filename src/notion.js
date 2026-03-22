const { Client } = require('@notionhq/client');

const BRAND_KIT_PAGE_ID = '32b843f1761181599ee0f28133667327';

let cachedBrandKit = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

function getNotionClient() {
  if (!process.env.NOTION_TOKEN) return null;
  return new Client({ auth: process.env.NOTION_TOKEN });
}

/**
 * Extrai texto de um bloco do Notion recursivamente.
 */
function extractBlockText(block) {
  const lines = [];

  const richTexts = block[block.type]?.rich_text || [];
  const text = richTexts.map(rt => rt.plain_text).join('');

  if (text) {
    if (block.type === 'heading_1') lines.push(`# ${text}`);
    else if (block.type === 'heading_2') lines.push(`## ${text}`);
    else if (block.type === 'heading_3') lines.push(`### ${text}`);
    else if (block.type === 'bulleted_list_item') lines.push(`- ${text}`);
    else if (block.type === 'numbered_list_item') lines.push(`• ${text}`);
    else if (block.type === 'paragraph') lines.push(text);
  }

  if (block.type === 'table' && block.table) {
    lines.push('[tabela]');
  }

  return lines.join('\n');
}

/**
 * Busca o brand kit do Notion. Usa cache de 1 hora.
 * Retorna string com o conteúdo ou null se indisponível.
 */
async function fetchBrandKit() {
  // Retorna cache se ainda válido
  if (cachedBrandKit && cacheTimestamp && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedBrandKit;
  }

  const notion = getNotionClient();
  if (!notion) return null;

  try {
    const blocks = await notion.blocks.children.list({
      block_id: BRAND_KIT_PAGE_ID,
      page_size: 100,
    });

    const lines = blocks.results
      .map(extractBlockText)
      .filter(Boolean);

    cachedBrandKit = lines.join('\n');
    cacheTimestamp = Date.now();
    return cachedBrandKit;
  } catch (err) {
    console.error('Erro ao buscar brand kit do Notion:', err.message);
    return null;
  }
}

module.exports = { fetchBrandKit };
