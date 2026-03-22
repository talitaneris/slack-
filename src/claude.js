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

module.exports = { callClaude };
