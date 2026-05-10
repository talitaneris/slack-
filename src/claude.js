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

module.exports = { callClaude, callClaudeWithHistory, callClaudeFast };
