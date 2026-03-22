# Deploy — Squad TNeris Bot
> Checklist para colocar o bot rodando na nuvem 24/7

---

## O que você precisa

### 1. Variáveis de ambiente
| Variável | Onde pegar |
|----------|-----------|
| `SLACK_BOT_TOKEN` | api.slack.com/apps → Squad TNeris Bot → OAuth & Permissions → Bot User OAuth Token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | api.slack.com/apps → Squad TNeris Bot → Basic Information → App Credentials → Signing Secret |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |

### 2. Permissões do Slack App (já deve ter, mas confirma)
Em api.slack.com/apps → Squad TNeris Bot → OAuth & Permissions → Bot Token Scopes:
- `app_mentions:read` — receber menções
- `chat:write` — postar mensagens
- `channels:read` — listar canais

---

## Railway (recomendado — mais simples)

1. Acessa **railway.app** → New Project → Deploy from GitHub Repo
2. Aponta para a pasta `squads/tneris/slack-bot/` (ou cria um repo separado)
3. Em **Variables**, adiciona:
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   ANTHROPIC_API_KEY=sk-ant-...
   ```
4. Railway detecta o `package.json` automaticamente e roda `npm start`
5. Depois do deploy, copia a **URL pública** (ex: `https://squad-tneris-bot.railway.app`)

---

## Render (alternativa)

1. Acessa **render.com** → New → Web Service
2. Conecta ao GitHub, seleciona a pasta do projeto
3. Configurações:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Adiciona as variáveis de ambiente
5. Copia a URL pública (ex: `https://squad-tneris-bot.onrender.com`)

> ⚠️ No plano gratuito do Render, o servidor "hiberna" após 15min sem requisições.
> Isso pode causar delay na primeira mensagem. Use o plano pago ($7/mês) para 24/7 real.

---

## Vercel (não recomendado para este projeto)
O bot usa conexão persistente e scheduler cron — não funciona bem em serverless.
Use Railway ou Render.

---

## Configurar o Slack Events API

Depois de ter a URL pública do servidor:

1. Acessa api.slack.com/apps → Squad TNeris Bot
2. **Event Subscriptions** → liga o toggle
3. **Request URL:** `https://SUA-URL.railway.app/slack/events`
   → Aguarda verificação automática ✓
4. **Subscribe to bot events** → Add Bot User Event:
   - `app_mention`
5. Clica **Save Changes**
6. **Reinstall** o app no workspace (aparece aviso no topo)

---

## Testar

No Slack, em qualquer canal onde o bot foi convidado:
```
@Squad TNeris Bot Jay, qual é a estratégia comercial da semana?
@Squad TNeris Bot Lua, quais são as prioridades hoje?
@Squad TNeris Bot Sofia, como está o MRR?
```

---

## Rotinas automáticas

O bot posta automaticamente todo dia às **8h (horário de Brasília)**:

| Agente | Canal | Todos os dias |
|--------|-------|---------------|
| 🤝 Assistente | #talita | ✅ |
| 🌙 Lua | #squadgeral | ✅ |
| ✍️ People | #marketing | ✅ |
| 🎨 Alex | #marketing | ✅ |
| 🎯 Lia | #vendas | ✅ |
| 📋 Marta | #vendas | ✅ |
| 📐 Paulo | #produto | ✅ |

| Agente | Canal | Dia |
|--------|-------|-----|
| ⭐ Vega + 📊 Jay + 📈 Lens | #marketing / #vendas / #gestao | Segunda |
| 🌿 Mari | #produto | Terça |
| 📈 Lens | #gestao | Quarta |
| 📊 Jay + 💰 Sofia + 📈 Lens | #gestao / #financeiro | Sexta |
| 🌙 Lua (debrief) | #squadgeral | Sábado |

---

## Monitoramento

- **Railway:** logs disponíveis no dashboard em tempo real
- **Render:** logs em Settings → Logs
- Se uma rotina falhar, ela loga o erro e continua as próximas (não trava)

---

## Custo estimado

| Serviço | Plano | Custo |
|---------|-------|-------|
| Railway | Hobby ($5 crédito/mês grátis) | ~$0–5/mês |
| Render | Free (com limitação) ou Starter | $0 ou $7/mês |
| Anthropic API | Pay as you go | ~$2–5/mês (Haiku) |
| **Total** | | **~$2–10/mês** |
