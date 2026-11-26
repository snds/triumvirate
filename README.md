# Triumvirate

A personal Destiny 2 companion: builds from your vault, god roll appraisal, vault cleanup,
farming and vendor picks, and an agent that learns how you play. Single-user (just me).

The full product plan lives in the "Destiny Companion — Product Plan" doc in the Claude project.

## Build order (v1 = everything)

| Step | What lands |
| --- | --- |
| 0 | Spike: sign in with Bungie, pull the profile, list every item by name (done) |
| 1 | Foundation: React web app, API server, snapshot sync, vault and character views (done) |
| 2 | **Appraisal (current):** wish-list roll scoring, vault cleanup list, agent side panel |
| 3 | Play-style profile (match history, loadouts, DIM) and build cards |
| 4 | Vendor highlights, farming list, weekly digest |
| 5 | Actions: move, equip, lock, loadouts (done); DIM tag write-back |
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
   The community wish list (about 30 MB) downloads on first use and refreshes once a day.

## Host it on Unraid

The app can also run on a home server at `https://triumvirate.snds-server.com`, as a Docker container behind a
Cloudflare Tunnel, with Cloudflare Access letting only you in. Step-by-step setup: [deploy/README.md](deploy/README.md).

## How the features work

- **Roll badges:** ★ god roll, ✓ recommended, ✕ no recommended roll matches. Perks are compared by name,
  so enhanced perks count. Source: the community "voltron" wish list DIM uses.
- **Cleanup:** duplicates with a better copy, lone rolls no list wants ("Check"), and armor beaten in every
  stat by another piece for the same class and slot ("Safe"). Locked and equipped items are never listed.
  **Copy DIM search** gives you an `id:` search to select them all in DIM.
- **Equip and lock:** the item panel has Equip on (one button per character) and a Lock toggle. Equipping
  brings the item over from the vault or another character first, makes room in a full slot, and swaps out a
  second exotic for your best legendary in that slot. Bungie only allows equipping in orbit, a social space, or offline.
- **Loadouts:** the in-game slots for each character (equip, save what you're wearing, rename and recolor,
  copy into Triumvirate), plus Triumvirate's own unlimited loadouts saved in `.data/loadouts.json`, which pull
  gear from anywhere. The builder picks one item per slot from any character or the vault. Every card shows
  the build at a glance: super, abilities, aspects, and fragments; armor set bonuses (on or locked); and
  artifact perks (a reminder only, since apps can't change them). Armor mods stay out of the summary.
- **Ask:** Claude (`claude-opus-5-5`) with read-only tools over your snapshot. Needs `ANTHROPIC_API_KEY` in `.env`.

Tokens and the manifest cache live in `.data/` (git-ignored). Never commit `.env`.

## Checks

```
pnpm typecheck
pnpm test
```

## Community weapon data

The server can build its own perk popularity data from Bungie's public API: it walks recent public
matches, looks up the weapons players still have equipped, and counts their perks, trait combos,
masterworks, and mods for each kind of activity (PvE endgame, PvE, patrol, PvP endgame, PvP, Gambit).
Only legendary and exotic weapons are counted, and only item hashes are saved, never player names.

- Start a crawl by hand (PowerShell): `Invoke-RestMethod -Method Post http://127.0.0.1:5444/api/community/crawl`
- Check on it: `Invoke-RestMethod http://127.0.0.1:5444/api/community/status`
- Run it nightly: set `COMMUNITY_CRAWL_HOUR=3` in `.env`.
- Data for one weapon: `GET /api/community/items/<itemHash>`.

Files live in `.data/community/`. A crawl makes at most 3,000 requests at 4 per second (about 15 minutes).

## Daily digest

Once a day the server syncs your inventory and writes a digest: new weapons and armor since yesterday (best first, with grades and stat totals), vendor weapons worth buying, and how full the vault is. With the assistant turned on, it opens with a few sentences on what to do first. Open it from the **Today** button in the top bar, or build one now from there.

- Build it each morning: set `DIGEST_HOUR=7` in `.env` (after a 3 AM crawl, so grades are fresh).
- Files live in `.data/digests/`, one per day; the last 30 are kept.

### Morning alert on your phone

When the scheduled digest is built, the server can send a notification to your phone (Web Push). Tapping it opens the digest.

- Turn it on from the **Morning alert** switch at the bottom of the digest, on each device you want alerts on. **Send a test** checks it right away.
- On iPhone (iOS 16.4 or later) it only works in the app added to the Home Screen, not in a Safari tab.
- Only the scheduled build sends one; tapping **Build today** doesn't, since you're already looking at it.
- Keys: the server makes a VAPID key pair the first time and keeps it in `.data/vapid.json`. To set your own, put `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in `.env` (`npx web-push generate-vapid-keys`). Changing keys turns alerts off on every device until you switch them on again.
- `VAPID_SUBJECT` is the contact address push services see; it defaults to `mailto:` plus the first address in `ALLOWED_EMAILS`.
- Devices are listed in `.data/push.json`. One that's been removed is dropped the next time an alert is sent.
