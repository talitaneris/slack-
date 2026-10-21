'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Conversas principais da Mariah — qualidade máxima
const MODEL = 'claude-sonnet-4-6';

// Tarefas auxiliares (extração de JSON, delegação, memória) — rápido e barato
const MODEL_FAST = 'claude-haiku-4-5-20251001';

async function callClaude(systemPrompt, userMessage, maxTokens = 1500) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });
  return response.content[0].text;
}

async function callClaudeWithHistory(systemPrompt, messages, maxTokens = 1500) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });
  return response.content[0].text;
}

// Para extração de JSON, classificações e tarefas auxiliares
async function callClaudeFast(systemPrompt, userMessage, maxTokens = 300) {
  const response = await client.messages.create({
    model: MODEL_FAST,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });
  return response.content[0].text;
}

// Curadoria: devolve o texto e o motivo de parada, sem retentativa, para cair no fallback rápido.
async function callClaudeFastDetailed(systemPrompt, userMessage, maxTokens = 300) {
  const response = await client.messages.create({
    model: MODEL_FAST,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  }, { timeout: 20000, maxRetries: 0 });
  const text = (response.content || [])
    .filter((block) => block && block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
  return { text, stopReason: response.stop_reason || '' };
}

module.exports = { callClaude, callClaudeWithHistory, callClaudeFast, callClaudeFastDetailed };
