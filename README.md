# OpenClash

ACP to OpenAI protocol conversion gateway. Expose ACP-based agents (like Cursor Agent, Qoder CLI) as OpenAI-compatible API endpoints.

## What it does

OpenClash acts as a bridge between the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) and the OpenAI Chat Completions API. It spawns ACP agent subprocesses, manages their lifecycle, and translates incoming OpenAI-format requests into ACP sessions — allowing any tool that speaks the OpenAI API to use ACP agents.

## Install

```bash
npm install @openplaw/openclash
```

## Usage

### As a standalone gateway

1. Create a config file at `~/.config/openclash/openclash.json`:

```json
{
  "server": {
    "port": 8080,
    "host": "0.0.0.0"
  },
  "providers": {
    "cursor-acp": {
      "name": "Cursor Agent (ACP)",
      "type": "acp",
      "options": {
        "command": "agent",
        "args": ["acp"],
        "env": {}
      },
      "models": {
        "auto": {
          "id": "auto",
          "name": "Cursor Auto",
          "limit": { "context": 200000, "output": 16384 }
        },
        "claude-opus-4-6": {
          "id": "claude-opus-4-6",
          "name": "Claude Opus 4.6",
          "limit": { "context": 200000, "output": 16384 }
        }
      }
    },
    "qoder-acp": {
      "name": "Qoder CLI (ACP)",
      "type": "acp",
      "options": {
        "command": "qodercli",
        "args": ["--acp"],
        "env": {
          "QODER_PERSONAL_ACCESS_TOKEN": "your-token"
        }
      },
      "models": {
        "auto": {
          "id": "auto",
          "name": "Qoder Auto",
          "limit": { "context": 200000, "output": 16384 }
        },
        "ultimate": {
          "id": "ultimate",
          "name": "Qoder Ultimate",
          "limit": { "context": 200000, "output": 16384 }
        }
      }
    }
  }
}
```

2. Start the gateway:

```bash
npx openclash start
# or with debug logging:
npx openclash start --log-level debug
```

3. Send requests using the OpenAI API format:

```bash
curl http://localhost:8080/cursor-acp/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### As an OpenCode plugin

Add to your `opencode.json`:

```json
{
  "plugin": ["@openplaw/openclash@latest"]
}
```

The plugin reads the same config file (`~/.config/openclash/openclash.json`) and starts the gateway automatically in the background. Then configure providers in `opencode.json` pointing to the local gateway:

```json
{
  "provider": {
    "cursor-acp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cursor (via OpenClash)",
      "options": {
        "baseURL": "http://localhost:8080/cursor-acp/v1"
      },
      "models": {
        "claude-opus-4-6": {
          "name": "Claude Opus 4.6",
          "limit": { "context": 200000, "output": 16384 }
        }
      }
    }
  }
}
```

## Configuration

| Field | Description |
|-------|-------------|
| `server.port` | Gateway port (default: `8080`) |
| `server.host` | Gateway host (default: `0.0.0.0`) |
| `providers.<id>.name` | Display name |
| `providers.<id>.type` | Always `"acp"` |
| `providers.<id>.apiKey` | Optional Bearer token for per-provider auth |
| `providers.<id>.options.command` | ACP agent binary path |
| `providers.<id>.options.args` | Arguments passed to the agent |
| `providers.<id>.options.env` | Environment variables for the subprocess |
| `providers.<id>.models` | Available models with context/output limits |

Config file location (in priority order):
1. `OPENCLASH_CONFIG` environment variable
2. `~/.config/openclash/openclash.json`

## CLI Commands

```
openclash start       Start the gateway server
openclash config      Print resolved configuration
openclash keygen      Generate an apiKey for a provider
openclash version     Print version
```

## Features

- Streaming (SSE) and non-streaming responses
- Per-provider Bearer token authentication
- Automatic model matching (fuzzy match for short aliases)
- Provider initialization with auto-reconnect
- OpenCode plugin mode (auto-start with TUI, auto-shutdown on exit)

## License

MIT
