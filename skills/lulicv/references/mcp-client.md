# MCP client setup

Set this up only when the user asks to connect a client through MCP; the Skill and CLI work without it. Add the server in the client's own settings or configuration file, in the format that client documents. A typical stdio entry, with absolute paths:

```json
{
  "mcpServers": {
    "lulicv": {
      "command": "node",
      "args": ["<absolute-skill-dir>/scripts/lulicv.mjs", "mcp"]
    }
  }
}
```

The server talks to the workspace's Bridge and starts it when it is not running, like the CLI. Write results carry `editor` as in SKILL.md; without a browser tool, give the user its `url`.

Desktop applications often do not inherit the terminal's PATH. If the client cannot find `node`, put the absolute path of a Node 18+ in `command`. Never put a token in the command or start a second Bridge to work around it.

Many clients read the tool list only when a session starts: after changing the configuration, restart the client or open a new session.
