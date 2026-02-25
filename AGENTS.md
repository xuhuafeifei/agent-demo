# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Agent Demo is a Node.js/TypeScript conversational AI web app using the `@mariozechner/pi-agent-core` framework. It serves a chat frontend via Express with SSE streaming. See `README.md` for full details.

### Running the dev server

Standard commands per `package.json`:
- `npm run build` — compile TypeScript
- `npm run dev` — build + start (`tsc && node dist/server.js`)
- `npm run watch` — watch mode (`tsc -w`)
- `npm start` — run compiled output

The server defaults to port 3000 (or `PORT` env var). If port 3000 is taken, it auto-selects a random port.

### LLM provider configuration

The app requires at least one working LLM provider. Configuration layers (highest priority first):
1. Environment variables (e.g. `MINIMAX_API_KEY`)
2. `config/model.json` (project-level, gitignored)
3. `~/.fgbg/fgbg.json` (global user config)

**Gotcha — Ollama provider is broken in code:** The built-in `ollama` provider does not work because `@mariozechner/pi-ai` does not recognize "ollama" as a known provider. `getModel()` returns `undefined` (not throwing), and the discovery code skips it. To use a local Ollama instance, configure a known pi-ai provider (e.g. `groq`) with its `baseUrl` overridden to `http://127.0.0.1:11434/v1`. Create a matching Ollama model alias (e.g. `ollama create llama3-8b-8192 -f Modelfile` with `FROM qwen2.5:0.5b`).

### Local Ollama setup (for dev without cloud API keys)

1. Ensure Ollama is running: `ollama serve` (background)
2. Pull a small model: `ollama pull qwen2.5:0.5b`
3. Create alias: `printf 'FROM qwen2.5:0.5b\n' > /tmp/Modelfile && ollama create llama3-8b-8192 -f /tmp/Modelfile`
4. Set in `.env`: `GROQ_API_KEY=ollama-local`
5. Set in `config/model.json`:
   ```json
   {"model":{"provider":"groq","model":"llama3-8b-8192","contextTokens":8192},"apiKey":{"groq":"ollama-local"}}
   ```
6. Set in `~/.fgbg/fgbg.json`:
   ```json
   {"models":{"providers":{"groq":{"baseUrl":"http://127.0.0.1:11434/v1","api":"openai-completions","apiKey":"ollama-local","models":[{"id":"llama3-8b-8192","name":"Llama 3 8B (local)","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":2048}]}}},"agents":{"defaults":{"model":{"primary":"groq/llama3-8b-8192"}}}}
   ```

### No linting or testing

This project has no ESLint config, no test framework, and no automated tests. The only verification is `npm run build` (TypeScript compilation).

### API endpoints

- `POST /api/chat` — send message, receive SSE stream
- `GET /api/history` — get conversation history
- `POST /api/clear` — clear conversation history
