'use strict';

const zlib = require('zlib');

function inflateIfNeeded(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      return zlib.gunzipSync(buffer);
    } catch {
      return buffer;
    }
  }
  return buffer;
}

function normalizeCharset(label) {
  if (!label) return '';
  const charset = String(label).trim().toLowerCase().replace(/['"]/g, '');
  if (charset === 'latin1' || charset === 'latin-1' || charset === 'iso8859-1' || charset === 'iso-8859-1') {
    return 'windows-1252';
  }
  if (charset === 'utf8') return 'utf-8';
  return charset;
}

function tryDecode(buffer, label) {
  try {
    return new TextDecoder(label, { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function scoreDecoded(text) {
  const replacement = (text.match(/\uFFFD/g) || []).length;
  const portuguese = (text.match(/[áàâãéêíóôõúç]/gi) || []).length;
  const mojibake = (text.match(/Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]/g) || []).length;
  return portuguese * 3 - replacement * 8 - mojibake * 4;
}

// Feeds like Folha declare ISO-8859-1. Others arrive gzipped, or as UTF-8
// bytes that a lenient decoder turns into "comparação" -> "compara��o".
function decodeFeed(buffer, contentType = '') {
  let buf = inflateIfNeeded(buffer);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
  }

  const head = buf.slice(0, 800).toString('latin1');
  const xmlEncoding = normalizeCharset(/encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1]);
  const httpEncoding = normalizeCharset(/charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1]);
  const declared = xmlEncoding || httpEncoding;
  const asUtf8 = tryDecode(buf, 'utf-8');
  const asLatin = tryDecode(buf, 'windows-1252');

  // Trust UTF-8 whenever the bytes are valid, unless the feed itself says
  // ISO-8859-1 (Folha) and those bytes are not valid UTF-8.
  let text;
  if (declared === 'windows-1252' && !asUtf8) {
    text = asLatin;
  } else if (asUtf8) {
    text = asUtf8;
  } else {
    text = asLatin || buf.toString('utf8');
  }

  if (text && /Ã[\u0080-\u00BF]/.test(text)) {
    try {
      const fixed = Buffer.from(text, 'latin1').toString('utf8');
      if (!fixed.includes('\uFFFD') && scoreDecoded(fixed) > scoreDecoded(text)) text = fixed;
    } catch {
      /* keep the first decode */
    }
  }

  return (text || '').replace(/^\uFEFF/, '').normalize('NFC');
}

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function cleanText(value, max) {
  if (!value) return '';
  let text = String(value).replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (max && text.length > max) text = text.slice(0, max).trim();
  return text;
}

module.exports = { decodeFeed, cleanText, inflateIfNeeded };
