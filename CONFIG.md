# Configuration

The recommended way to configure the extension is **Fuuz: Add Connection by API
Key** — it detects the tenant, enterprise and environment from the key and stores
the token securely. This document describes what gets stored and how to adjust it.

## What is stored where

- **Connection metadata** → user settings under `fuuz.enterprises` (and
  `fuuz.activeEnterprise` / `fuuz.activeTenant`). Scope: `application`.
- **Access tokens** → VS Code **SecretStorage**. Never in settings or source control.
- **Synced resources** → extension `globalState` cache (not settings).

## Endpoints derive from the environment slug

An enterprise's `environment` slug (e.g. `build.mfgx`, `admin`) drives every
endpoint from `https://api.{environment}.fuuz.app`:

| Purpose | Default URL | Override key |
| --- | --- | --- |
| MCP server | `…/mcp` | `mcpServerUrl` |
| Flow execution | `…/orchestration/executeFlow` | `flowExecutionUrl` |
| Webhook | `…/webhook/post/{topic}` | `webhookUrl` |

Set these in the config panel (**Edit environment & endpoints**) or in settings.

## Settings shape

```json
{
  "fuuz.enterprises": [
    {
      "id": "fuuz-administration",
      "name": "Fuuz Administration",
      "environment": "admin",
      "tenants": [
        { "id": "fuuzAdministrationBuild", "name": "Build" }
      ]
    }
  ],
  "fuuz.activeEnterprise": "fuuz-administration",
  "fuuz.activeTenant": "fuuzAdministrationBuild"
}
```

Notes:
- There is **no `apiKey`** field — tokens live in SecretStorage. (Legacy
  plaintext `apiKey` values from older configs are migrated to SecretStorage on
  startup and removed from settings.)
- `mcpEndpoint` is derived from `environment` when omitted; it and the per-endpoint
  `*Url` fields are optional overrides.
- A tenant may carry `"disabled": true` — kept in config but excluded from MCP
  registration and `.vscode/mcp.json`.

## Tenants in different environments

An enterprise's tenants can live in different environments (e.g. Build, QA,
Prod). A tenant with its own `environment` resolves every endpoint — including
its MCP server — from that slug; a tenant without one inherits the enterprise's.

```json
{
  "id": "fuuz-administration",
  "environment": "build.mfgx",
  "tenants": [
    { "id": "adminBuild", "name": "Build" },
    { "id": "adminQa", "name": "QA", "environment": "qa.mfgx" }
  ]
}
```

- **Add Connection by API Key** sets this automatically when the key's
  environment differs from the enterprise's.
- A tenant with its own `environment` does **not** inherit the enterprise's
  `*Url` overrides (they point at the enterprise's host). Tenants accept the same
  `mcpServerUrl` / `flowExecutionUrl` / `webhookUrl` overrides.
- QA targets and **Open in Fuuz** use the active tenant's environment.

## Managing connections

In **Fuuz: Configure Connections**: set active, **Test endpoints**, **Replace
key**, **Disable/Enable**, and remove. Replacing a key prompts for the new value,
stores it securely, and re-probes all endpoints.

## `.vscode/mcp.json`

**Fuuz: Write MCP Server Config** writes the enabled tenants as HTTP MCP servers.
Tokens are referenced via a password `${input:…}` prompt, so the secret is not
written to disk. Existing non-Fuuz entries in the file are preserved.

## Claude auto-register

With `fuuz.claudeAutoRegister` on (default `userAndDesktop`), the enabled
connections are written to `~/.claude.json` (Claude Code) and Claude Desktop's
`claude_desktop_config.json`. This happens on startup and on every connection
change, with the token embedded. Set it to `off` in **User** settings to stop
this. It is application-scoped, so a workspace `.vscode/settings.json` value is
ignored. Entries already written stay until removed (`claude mcp remove <name>`).

Each sync **replaces every `fuuz-*` entry** with the connections of the VS Code
instance that ran it. Two instances with different connection sets (e.g. a
second profile or a `--user-data-dir` test window) overwrite each other, and
whichever syncs last decides what Claude sees. Keep one set of connections, or
turn auto-register off in the other instance.

## MCP availability

If your subscription does not include MCP, MCP-dependent features (server
registration, auto resource loading, key validation) are unavailable. The
per-endpoint **Test** badges show which endpoints your key can reach; configure
flows in Fuuz to provide resources manually when MCP is off.

## Troubleshooting

- **401 / "API key is not active"** — the key is expired/inactive for that
  endpoint; request a fresh key. Badges show the status per endpoint.
- **Wrong host** — if an environment's MCP host doesn't match
  `api.{slug}.fuuz.app`, set the `mcpServerUrl` override.
