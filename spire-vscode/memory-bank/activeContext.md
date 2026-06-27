# Active Context

## Current Focus
MCP config stripped of auto-generation — `readConfigFile` now throws instead of writing defaults. Config must be provided externally via `~/.spire/mcp.json`.

## Recent Changes
- **`src/mcp/mcp-config.ts`** — Stripped default-generation logic:
  - Removed `writeDefaultConfig()`, `resolveNodeBinary()`, `nodeServerConfig()`, `resolveTerminalServerPath()`, `resolvePackageEntry()` helpers
  - `readConfigFile()` now throws `Error` if `~/.spire/mcp.json` doesn't exist (instead of creating it)
  - Simplified `loadMcpConfig()`/`reloadMcpConfig()` — they read the file, resolve `\${workspaceRoot}` placeholders, and return; no fallback generation
  - Kept `resolvePlaceholders()`, `validateMcpConfig()`, `toMcpServerConfig()`, `getConfigFilePath()`
  - Removed unused `McpServerInfo` import
- Built successfully with `tsc --noEmit` (0 errors)
- **`.spire/mcp.json`** — Updated the `filesystem` server's command to point to the pre-installed `node_modules/@modelcontextprotocol/server-filesystem` (fixing the `MODULE_NOT_FOUND` error)

## Next Steps
- Test the extension in VS Code (F5 launch)
- Verify MCP servers start correctly from the bundled config
- Add more MCP server integrations
- Implement memory bank persistence and retrieval
- Add unit tests

## Known Issues
- `McpClient` SSE transport not yet implemented (only stdio)
