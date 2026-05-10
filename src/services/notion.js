'use strict';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function getHeaders() {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error('NOTION_API_KEY ausente');
  return {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function isConfigured() {
  return !!process.env.NOTION_API_KEY;
}

// ─── BUSCA ────────────────────────────────────────────────────

async function searchNotion(query) {
  const res = await fetch(`${NOTION_API}/search`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ query, page_size: 8 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro na busca');

  return (data.results || []).map(item => {
    const title = extractTitle(item);
    const type = item.object === 'database' ? 'Database' : 'Página';
    return `• [${type}] ${title} — ID: ${item.id}`;
  }).join('\n') || 'Nenhum resultado encontrado.';
}

// ─── LER PÁGINA ───────────────────────────────────────────────

async function readPage(pageId) {
  const cleanId = pageId.replace(/-/g, '');

  const [pageRes, blocksRes] = await Promise.all([
    fetch(`${NOTION_API}/pages/${cleanId}`, { headers: getHeaders() }),
    fetch(`${NOTION_API}/blocks/${cleanId}/children?page_size=50`, { headers: getHeaders() }),
  ]);

  const page = await pageRes.json();
  const blocks = await blocksRes.json();

  if (!pageRes.ok) throw new Error(page.message || 'Página não encontrada');

  const title = extractTitle(page);
  const content = (blocks.results || []).map(blockToText).filter(Boolean).join('\n');

  return `# ${title}\n\n${content || '(página sem conteúdo de texto)'}`.slice(0, 6000);
}

// ─── LER DATABASE ─────────────────────────────────────────────

async function queryDatabase(databaseId, filter = null) {
  const cleanId = databaseId.replace(/-/g, '');
  const body = { page_size: 20 };
  if (filter) body.filter = filter;

  const res = await fetch(`${NOTION_API}/databases/${cleanId}/query`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro ao ler database');

  return (data.results || []).map(item => {
    const title = extractTitle(item);
    const props = formatProperties(item.properties);
    return `• ${title}${props ? ' — ' + props : ''}`;
  }).join('\n') || 'Database vazio.';
}

// ─── CRIAR PÁGINA ─────────────────────────────────────────────

async function createPage(parentId, title, content = '', isDatabase = false) {
  const cleanId = parentId.replace(/-/g, '');
  const parent = isDatabase
    ? { database_id: cleanId }
    : { page_id: cleanId };

  const body = {
    parent,
    properties: {
      title: { title: [{ text: { content: title } }] },
    },
  };

  if (content) {
    body.children = content.split('\n').filter(Boolean).map(line => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ text: { content: line } }] },
    }));
  }

  const res = await fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro ao criar página');

  return `Página "${title}" criada no Notion.`;
}

// ─── ATUALIZAR PROPRIEDADE ────────────────────────────────────

async function updatePageProperty(pageId, propertyName, value) {
  const cleanId = pageId.replace(/-/g, '');
  const body = {
    properties: {
      [propertyName]: { select: { name: value } },
    },
  };

  const res = await fetch(`${NOTION_API}/pages/${cleanId}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro ao atualizar');

  return `Propriedade "${propertyName}" atualizada para "${value}".`;
}

// ─── HELPERS ──────────────────────────────────────────────────

function extractTitle(item) {
  if (item.properties?.title?.title?.[0]?.plain_text) return item.properties.title.title[0].plain_text;
  if (item.properties?.Name?.title?.[0]?.plain_text) return item.properties.Name.title[0].plain_text;
  if (item.properties?.Título?.title?.[0]?.plain_text) return item.properties.Título.title[0].plain_text;
  const titleProp = Object.values(item.properties || {}).find(p => p.type === 'title');
  return titleProp?.title?.[0]?.plain_text || '(sem título)';
}

function blockToText(block) {
  const type = block.type;
  const content = block[type];
  const text = content?.rich_text?.map(t => t.plain_text).join('') || '';

  if (type === 'heading_1') return `\n## ${text}`;
  if (type === 'heading_2') return `\n### ${text}`;
  if (type === 'heading_3') return `\n#### ${text}`;
  if (type === 'bulleted_list_item') return `• ${text}`;
  if (type === 'numbered_list_item') return `- ${text}`;
  if (type === 'to_do') return `[${content.checked ? 'x' : ' '}] ${text}`;
  if (type === 'paragraph') return text;
  if (type === 'quote') return `> ${text}`;
  if (type === 'code') return `\`${text}\``;
  return text;
}

function formatProperties(props) {
  const parts = [];
  for (const [key, val] of Object.entries(props || {})) {
    if (val.type === 'title') continue;
    if (val.type === 'select' && val.select?.name) parts.push(`${key}: ${val.select.name}`);
    if (val.type === 'status' && val.status?.name) parts.push(`${key}: ${val.status.name}`);
    if (val.type === 'date' && val.date?.start) parts.push(`${key}: ${val.date.start}`);
    if (val.type === 'checkbox') parts.push(`${key}: ${val.checkbox ? '✓' : '✗'}`);
    if (val.type === 'number' && val.number != null) parts.push(`${key}: ${val.number}`);
    if (val.type === 'rich_text' && val.rich_text?.[0]) parts.push(`${key}: ${val.rich_text[0].plain_text}`);
  }
  return parts.slice(0, 4).join(' | ');
}

module.exports = { isConfigured, searchNotion, readPage, queryDatabase, createPage, updatePageProperty };
