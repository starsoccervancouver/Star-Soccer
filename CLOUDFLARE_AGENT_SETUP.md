# Cloudflare setup for Star Soccer's Codex workspace

The official Cloudflare setup instructions are at <https://developers.cloudflare.com/agent-setup/prompt.md>.
Cloudflare's Codex guide is at <https://developers.cloudflare.com/agent-setup/codex/>.

## Prepared in this repository

- `.codex/config.toml` registers Cloudflare API, docs, Workers bindings, builds, and observability MCP endpoints for Codex.
- The configuration contains **no credentials**. It applies when you open this repository as a **trusted project** in Codex.
- The public Cloudflare Docs server works without OAuth. Cloudflare account APIs ask the owner to authorize access when first used.
- This is an AI coding-agent integration, **not** a DNS, hosting, or website migration. The existing website and GitHub Pages workflows remain unchanged.

## Finish on your own Windows computer

Cloudflare Skills are installed in your **local Codex environment**, not in GitHub. From the project directory in Windows Terminal (PowerShell with Node.js/npm available), run:

```powershell
npx -y skills add cloudflare/skills --skill '*' --yes --global
```

Alternatively, in the Codex app, open **Plugins** and install **Cloudflare** (official Cloudflare-recommended method). If you use the plugin to install the same MCP servers, avoid adding duplicate user-level definitions: this repository already has project-scoped MCP configuration.

Then restart Codex, open this repository, trust the project if prompted, and inspect the MCP connections (`/mcp` inside Codex or `codex mcp list` in the terminal).

To connect your Cloudflare account, run `codex mcp login cloudflare` locally or authenticate from the MCP UI and review the requested permissions. This interactive OAuth step must be completed by the account owner. Do not paste an API token or password into chat or commit it to this repository.

## If the project config isn't loaded

Codex reads `.codex/config.toml` only for trusted projects. To use the connections **outside** this repository, add them to your user-level `~/.codex/config.toml` or install the Cloudflare plugin in your Codex desktop app. See <https://learn.chatgpt.com/docs/extend/mcp>.

## Verification

After authorization, ask Codex: "Use Cloudflare Docs MCP to check the current recommended way to configure a Worker" and then "List my Cloudflare accounts using the Cloudflare MCP server." Do not change DNS, deploy, or grant broad permissions until you review the intended account and the specific operation.
