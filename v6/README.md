# Sardis V6

Sardis V6 is an isolated, dependency-free vertical slice. It uses Node's standard library, the existing local Ollama endpoint, and small native adapters for weather, currency, and web research.

## Run

From this directory:

```text
node server.js
```

Open `http://127.0.0.1:3060`.

Optional environment variables: `OLLAMA_URL` (default `http://127.0.0.1:11434`), `OLLAMA_MODEL` (default `qwen3:1.7b`), and `V6_PORT`.

## Check

```text
node --check server.js
node tests/conversation.test.js
```

The application exposes `/api/health`, `/api/chat` (NDJSON streaming), `/api/session`, and `/api/sessions`. `v6/data/state.json` is created automatically for sessions and persistent facts. The V5 root `server.js` and `index.html` are not imported or changed.

