# ZeuS Deployment

## Node Version Lock

ZeuS production runs on **Node 20.20.2**.

| Layer | Pinned |
|-------|--------|
| nvm default | 20 |
| .nvmrc | 20.20.2 |
| package.json engines | >=20.20.0 <21.0.0 |
| ecosystem.config.js interpreter | /root/.nvm/versions/node/v20.20.2/bin/node |

### Rules

- NEVER restart PM2 daemon under a different Node version
- ALWAYS rebuild native modules with default Node: `npm rebuild`
- If PM2 daemon needs restart: `node -v` (verify 20.x) then `pm2 kill && pm2 resurrect`
- If Node version mismatch (MODULE_VERSION error):
  1. `pm2 show zeus | grep "node.js version"` — must be 20.x
  2. `node -v` — must be 20.x
  3. If mismatch: `pm2 kill && pm2 resurrect` (restarts daemon under current shell node)
  4. Then `npm rebuild better-sqlite3`

### Incident 2026-05-26

WARP install on May 20 pulled Node 22 and left PM2 daemon running under Node 22.
`npm rebuild better-sqlite3` under Node 20 compiled binary for MODULE_VERSION 115,
but PM2 (Node 22) required MODULE_VERSION 127 — crash-loop (65 restarts).

Recovery: `pm2 kill` + `pm2 resurrect` (under Node 20) + `npm rebuild better-sqlite3`.

Prevention: interpreter pinned in ecosystem.config.js + .nvmrc + package.json engines.

Note: current better-sqlite3 prebuilt binary loads on both Node 20 + 22 — but treat as Node 20-only for upgrade decisions.
