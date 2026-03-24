const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Chama a API da Anthropic com o system prompt do agente e a mensagem do usuário.
 * Retorna o texto da resposta.
 */
async function callClaude(systemPrompt, userMessage, maxTokens = 800) {
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

/**
 * Chama a API da Anthropic passando um histórico de mensagens completo.
 * Permite incluir o contexto do thread para respostas mais coerentes.
 *
 * @param {string} systemPrompt  - System prompt do agente
 * @param {Array}  messages      - Array de { role: 'user'|'assistant', content: string }
 * @param {number} maxTokens     - Limite de tokens da resposta
 */
async function callClaudeWithHistory(systemPrompt, messages, maxTokens = 800) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  return response.content[0].text;
}

module.exports = { callClaude, callClaudeWithHistory };
