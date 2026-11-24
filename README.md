# Triumvirate

A personal Destiny 2 companion: builds from your vault, god roll appraisal, vault cleanup,
farming and vendor picks, and an agent that learns how you play. Single-user (just me).

The full product plan lives in the "Destiny Companion — Product Plan" doc in the Claude project.

## Build order (v1 = everything)

| Step | What lands |
| --- | --- |
| 0 | Spike: sign in with Bungie, pull the profile, list every item by name (done) |
| 1 | **Foundation (current):** React web app, API server, snapshot sync, vault and character views |
| 2 | Wish-list roll scoring, vault cleanup list, agent side panel |
| 3 | Play-style profile (match history, loadouts, DIM) and build cards |
| 4 | Vendor highlights, farming list, weekly digest |
| 5 | Actions: move, equip, lock, apply loadout, DIM tag write-back |
| 6 | Armor optimizer, Claude chat tool (MCP server), phone install |
| 7 | Destiny 1, read-only |

## Layout

- `packages/core` — Bungie client, OAuth, manifest cache, profile summarizer. No UI.
- `apps/server` — API server (Hono) on `127.0.0.1:5444`: sign-in, profile sync, snapshots in `.data/snapshots`.
- `apps/web` — React app (Vite) on `https://localhost:5443`. Forwards `/api` and `/auth` to the server.
  Design tokens live in `apps/web/src/tokens.css` (global → semantic → component).

## Run it

1. Create an app at <https://www.bungie.net/en/Application>:
   - **OAuth Client Type:** Confidential
   - **Redirect URL:** `https://localhost:5443/auth/callback`
   - **Scope:** the first three boxes (Destiny 2 read, Destiny 1 vendor read, move or equip). Leave clans and notifications off.
   - **Origin Header:** leave blank (all calls go through the local server, not the browser)
2. Copy `.env.example` to `.env` and paste in the API key, OAuth client_id, and client_secret.
3. Install and run (needs Node 22+ and pnpm). `pnpm dev` starts both the web app and the API server:

   ```
   pnpm install
   pnpm dev
   ```

4. Open <https://localhost:5443>, accept the self-signed certificate warning, and sign in.
   The first load after the server starts reads the item database (about 60 MB), so give it a few seconds.
   **Refresh** pulls a fresh copy of your profile and saves it as a snapshot (the last 50 are kept).

Tokens and the manifest cache live in `.data/` (git-ignored). Never commit `.env`.

## Checks

```
pnpm typecheck
pnpm test
```
