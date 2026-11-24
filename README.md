# Waypoint

A personal Destiny 2 companion: builds from your vault, god roll appraisal, vault cleanup,
farming and vendor picks, and an agent that learns how you play. Single-user (just me).

The full product plan lives in the "Destiny Companion — Product Plan" doc in the Claude project.

## Build order (v1 = everything)

| Step | What lands |
| --- | --- |
| 0 | **Spike (this commit):** sign in with Bungie, pull the profile, list every item by name |
| 1 | Foundation: hosted site, snapshot sync, vault and character views |
| 2 | Wish-list roll scoring, vault cleanup list, agent side panel |
| 3 | Play-style profile (match history, loadouts, DIM) and build cards |
| 4 | Vendor highlights, farming list, weekly digest |
| 5 | Actions: move, equip, lock, apply loadout, DIM tag write-back |
| 6 | Armor optimizer, Claude chat tool (MCP server), phone install |
| 7 | Destiny 1, read-only |

## Layout

- `packages/core` — Bungie client, OAuth, manifest cache, profile summarizer. No UI.
- `apps/spike` — Step 0 throwaway HTTPS page that proves the pipes work.

## Run the spike

1. Create an app at <https://www.bungie.net/en/Application>:
   - **OAuth Client Type:** Confidential
   - **Redirect URL:** `https://localhost:5443/auth/callback`
   - **Scope:** the first three boxes (Destiny 2 read, Destiny 1 vendor read, move or equip). Leave clans and notifications off.
   - **Origin Header:** leave blank (all calls go through the local server, not the browser)
2. Copy `.env.example` to `.env` and paste in the API key, OAuth client_id, and client_secret.
3. Install and run (needs Node 22+ and pnpm):

   ```
   pnpm install
   pnpm dev
   ```

4. Open <https://localhost:5443>, accept the self-signed certificate warning, and sign in.
   The first load downloads part of the Bungie manifest into `.data/`, so it takes a moment.

Tokens and the manifest cache live in `.data/` (git-ignored). Never commit `.env`.

## Checks

```
pnpm typecheck
pnpm test
```
