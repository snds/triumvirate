// Community data collector: crawls recent public matches through the Bungie API, records which
// legendary/exotic rolls people actually use in each kind of activity, and keeps rollups on disk.
//
// Politeness: one request at a time, at most `ratePerSecond`, with a back-off when Bungie says
// slow down. Each run has a request budget so a crawl never runs away.
//
// Files under .data/community/:
//   samples-YYYY-MM.jsonl  one Sample per line (hashes only, no player names or ids)
//   state.json             seen match ids, players to visit next, last run summary
//   rollup.json            usage over the last 30 days (what the UI reads)
//   history/YYYY-MM.json   one rollup per month, for usage trends over time
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HttpClient, HttpClientConfig } from 'bungie-api-ts/http';
import {
  getActivityHistory, getPostGameCarnageReport, getProfile,
  type DestinyPostGameCarnageReportData, type DestinyProfileResponse,
} from 'bungie-api-ts/destiny2';
import { extractSamples, rollup, type CommunityRollup, type ManifestTables, type Sample } from '@triumvirate/core';

// DestinyComponentType numbers: Profiles (character ids), CharacterEquipment, ItemSockets.
const PROFILE_COMPONENTS = [100, 205, 305];
const KEEP_SEEN = 50_000;
const KEEP_FRONTIER = 5_000;
const ROLLUP_DAYS = 30;
/** A Bungie call that hangs longer than this is given up on, so a crawl can never stay "running" forever. */
const CALL_TIMEOUT_MS = 30_000;

export interface Player { membershipType: number; membershipId: string }

export interface CrawlOptions {
  /** Bungie calls this run may make. Default 3000 (about 15 minutes at the default rate). */
  maxRequests?: number;
  /** Only matches newer than this, so equipped gear still matches what was used. Default 6. */
  maxAgeHours?: number;
  /** Default 4. Bungie's own limit is much higher; we stay well under it. */
  ratePerSecond?: number;
}

export interface CrawlStatus {
  running: boolean;
  startedAt?: string;
  requests: number;
  matches: number;
  samples: number;
  error?: string;
  lastRun?: { finishedAt: string; requests: number; matches: number; samples: number; error?: string };
  totalSamples?: number;
}

interface State {
  seen: string[];
  frontier: Player[];
  lastRun?: CrawlStatus['lastRun'];
}

export interface CommunityDeps {
  dataDir: string;
  /** An API-key-only client: every call here is public data. */
  http: HttpClient;
  manifest: () => Promise<ManifestTables | undefined>;
  /** Where a crawl starts when there is no saved frontier: the signed-in player. */
  seed: () => Promise<Player | undefined>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Where crawl and schedule messages go. Default: the console, so they show in `docker logs`. */
  log?: (msg: string) => void;
  /** Where failures go. Default: console.error. */
  logError?: (msg: string, err?: unknown) => void;
  /** Default: the JS default (process.env.TZ or the system zone). Only for tests. */
  timeZone?: string;
}

/** Why a crawl started, for the log. */
export type CrawlTrigger = 'schedule' | 'manual';

const month = (iso: string) => iso.slice(0, 7);

export function createCommunity(deps: CommunityDeps) {
  const dir = join(deps.dataDir, 'community');
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((msg: string) => console.log(`[community] ${msg}`));
  const logError = deps.logError ?? ((msg: string, err?: unknown) => console.error(`[community] ${msg}`, ...(err === undefined ? [] : [err])));
  const timeOf = (d: Date) => d.toLocaleString('en-US', { timeZone: deps.timeZone, dateStyle: 'medium', timeStyle: 'short' });
  let status: CrawlStatus = { running: false, requests: 0, matches: 0, samples: 0 };
  let stopRequested = false;
  let current: CommunityRollup | undefined;
  let history: Record<string, CommunityRollup> | undefined;

  async function readJson<T>(file: string): Promise<T | undefined> {
    try { return JSON.parse(await readFile(join(dir, file), 'utf8')); } catch { return undefined; }
  }
  async function writeJson(file: string, data: unknown) {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await writeFile(join(dir, file), JSON.stringify(data));
  }

  /** Wraps the client with pacing, a request budget, and one back-off retry when throttled. */
  function paced(http: HttpClient, opts: Required<CrawlOptions>): HttpClient {
    const gap = 1000 / opts.ratePerSecond;
    let last = 0;
    return async <T>(config: HttpClientConfig): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        if (stopRequested) throw new StopCrawl();
        if (status.requests >= opts.maxRequests) throw new StopCrawl();
        const wait = last + gap - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        status.requests++;
        try {
          return await withTimeout(http<T>(config), CALL_TIMEOUT_MS);
        } catch (e) {
          // 1672 ThrottleLimitExceeded, 36/51 per-endpoint throttles, or a non-JSON 5xx page.
          const msg = String((e as Error).message);
          const throttled = /error (36|51|1672)\b|Unexpected token|not valid JSON/i.test(msg);
          if (!throttled || attempt >= 2) throw e;
          await sleep(10_000 * (attempt + 1));
        }
      }
    };
  }

  async function crawl(opts: CrawlOptions = {}, trigger: CrawlTrigger = 'manual'): Promise<CrawlStatus> {
    if (status.running) {
      log(`Crawl (${trigger}) not started: another crawl has been running since ${status.startedAt}.`);
      return status;
    }
    const o: Required<CrawlOptions> = { maxRequests: 3000, maxAgeHours: 6, ratePerSecond: 4, ...opts };
    stopRequested = false;
    const started = now();
    status = { running: true, startedAt: started.toISOString(), requests: 0, matches: 0, samples: 0, lastRun: status.lastRun };
    let discovery = 0;
    const found: Sample[] = [];
    let state: State = { seen: [], frontier: [] };
    let loaded = false;
    try {
      const manifest = await deps.manifest();
      if (!manifest) throw new Error('Item data is not loaded yet.');
      state = (await readJson<State>('state.json')) ?? state;
      loaded = true;
      const seen = new Set(state.seen);
      const queued = new Set(state.frontier.map((p) => p.membershipId));
      let seeded = false;
      if (!state.frontier.length) {
        const me = await deps.seed();
        if (!me) throw new Error('Sign in once so the crawl has a starting player.');
        state.frontier.push(me);
        queued.add(me.membershipId);
        seeded = true;
      }
      log(`Crawl (${trigger}) started: ${seeded ? 'fresh start from your own account' : `${state.frontier.length} players queued`}, ` +
        `budget ${o.maxRequests} requests, matches from the last ${o.maxAgeHours} hours.`);
      const http = paced(deps.http, o);
      const profiles = new Map<string, DestinyProfileResponse | undefined>();
      const profileOf = async (p: Player) => {
        if (!profiles.has(p.membershipId)) {
          try {
            const r = await getProfile(http, { membershipType: p.membershipType, destinyMembershipId: p.membershipId, components: PROFILE_COMPONENTS as never });
            profiles.set(p.membershipId, r.Response);
          } catch (e) {
            if (e instanceof StopCrawl) throw e;
            profiles.set(p.membershipId, undefined); // private, deleted, or wrong platform: skip
          }
        }
        return profiles.get(p.membershipId);
      };
      const cutoff = now().getTime() - o.maxAgeHours * 3_600_000;
      const enqueue = (pgcr: DestinyPostGameCarnageReportData) => {
        for (const e of pgcr.entries) {
          const u = e.player.destinyUserInfo;
          const p = { membershipType: u.crossSaveOverride || u.membershipType, membershipId: u.membershipId };
          if (!queued.has(p.membershipId) && state.frontier.length < KEEP_FRONTIER) {
            state.frontier.push(p);
            queued.add(p.membershipId);
          }
        }
      };

      try {
        while (state.frontier.length) {
          const player = state.frontier.shift()!;
          queued.delete(player.membershipId);
          const profile = await profileOf(player);
          // Matches too old to sample. They still name other players to visit.
          const older: string[] = [];
          for (const characterId of profile?.profile?.data?.characterIds ?? []) {
            let recent;
            try {
              recent = (await getActivityHistory(http, {
                membershipType: player.membershipType, destinyMembershipId: player.membershipId, characterId, count: 5, page: 0,
              } as never)).Response.activities ?? [];
            } catch (e) {
              if (e instanceof StopCrawl) throw e;
              continue;
            }
            for (const a of recent) {
              const id = a.activityDetails.instanceId;
              if (seen.has(id)) continue;
              if (Date.parse(a.period) < cutoff) { older.push(id); continue; }
              seen.add(id);
              let pgcr: DestinyPostGameCarnageReportData;
              try {
                pgcr = (await getPostGameCarnageReport(http, { activityId: id })).Response;
              } catch (e) {
                if (e instanceof StopCrawl) throw e;
                continue;
              }
              status.matches++;
              const byId: Record<string, DestinyProfileResponse | undefined> = {};
              for (const e of pgcr.entries) {
                const u = e.player.destinyUserInfo;
                byId[u.membershipId] = await profileOf({ membershipType: u.crossSaveOverride || u.membershipType, membershipId: u.membershipId });
              }
              enqueue(pgcr);
              const s = extractSamples(manifest, pgcr, byId);
              found.push(...s);
              status.samples += s.length;
            }
          }
          // About to run out of players (say, a fresh start when you haven't played tonight):
          // use this player's older matches only to find more players. Nothing is sampled from them,
          // because the gear people wear now may not be what they used back then.
          if (!state.frontier.length) {
            for (const id of older) {
              seen.add(id);
              try {
                enqueue((await getPostGameCarnageReport(http, { activityId: id })).Response);
                discovery++;
              } catch (e) {
                if (e instanceof StopCrawl) throw e;
              }
            }
          }
        }
      } catch (e) {
        if (!(e instanceof StopCrawl)) throw e;
      }
      state.seen = [...seen].slice(-KEEP_SEEN);
      await saveSamples(found);
      await rebuild(manifest);
    } catch (e) {
      status.error = (e as Error).message;
      // The scheduler can't see this (crawl resolves either way), so say it here.
      logError(`Crawl (${trigger}) failed:`, e);
      // Keep whatever was collected before the failure.
      await saveSamples(found).catch((err) => logError('Could not save samples:', err));
    } finally {
      const { requests, matches, samples, error } = status;
      state.lastRun = { finishedAt: now().toISOString(), requests, matches, samples, ...(error ? { error } : {}) };
      // A run that failed before reading state.json (say, item data didn't load) still records its
      // result there, so a failed night is visible on disk and not mistaken for one that never ran.
      if (!loaded) state = { ...((await readJson<State>('state.json')) ?? state), lastRun: state.lastRun };
      await writeJson('state.json', state).catch((err) => logError('Could not save state.json:', err));
      status = { ...status, running: false, lastRun: state.lastRun, totalSamples: await countSamples().catch(() => undefined) };
      const minutes = Math.round((now().getTime() - started.getTime()) / 60_000);
      log(`Crawl (${trigger}) ${error ? 'stopped early' : 'finished'} after ${minutes} min: ${requests} requests, ${matches} matches, ` +
        `${samples} samples${discovery ? `, ${discovery} older matches used to find players` : ''}, ${state.frontier.length} players left to visit.`);
      if (!error && !matches) log('No recent matches were found, so no new data. The next run picks up from the players found this time.');
    }
    return status;
  }

  async function saveSamples(samples: Sample[]) {
    if (!samples.length) return;
    await mkdir(dir, { recursive: true });
    const byMonth = new Map<string, string[]>();
    for (const s of samples) {
      const m = month(s.at);
      byMonth.set(m, [...(byMonth.get(m) ?? []), JSON.stringify(s)]);
    }
    for (const [m, lines] of byMonth) await appendFile(join(dir, `samples-${m}.jsonl`), lines.join('\n') + '\n');
  }

  async function sampleMonths(): Promise<string[]> {
    try {
      return (await readdir(dir)).map((f) => /^samples-(\d{4}-\d{2})\.jsonl$/.exec(f)?.[1]).filter((m): m is string => !!m).sort();
    } catch { return []; }
  }

  async function readMonth(m: string): Promise<Sample[]> {
    const text = await readFile(join(dir, `samples-${m}.jsonl`), 'utf8').catch(() => '');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Sample);
  }

  async function countSamples() {
    let n = 0;
    for (const m of await sampleMonths()) n += (await readMonth(m)).length;
    return n;
  }

  /** Rebuilds the 30-day rollup and the monthly history from the sample files. */
  async function rebuild(manifest: ManifestTables) {
    const months = await sampleMonths();
    const since = new Date(now().getTime() - ROLLUP_DAYS * 86_400_000).toISOString();
    const recent: Sample[] = [];
    history = {};
    for (const m of months) {
      const samples = await readMonth(m);
      history[m] = rollup(manifest, samples, now());
      await writeJson(`history/${m}.json`, history[m]);
      if (m >= month(since)) recent.push(...samples.filter((s) => s.at >= since));
    }
    current = rollup(manifest, recent, now());
    await writeJson('rollup.json', current);
  }

  async function loadRollups() {
    current ??= await readJson<CommunityRollup>('rollup.json');
    if (!history) {
      history = {};
      for (const m of await sampleMonths()) {
        const h = await readJson<CommunityRollup>(`history/${m}.json`);
        if (h) history[m] = h;
      }
    }
  }

  return {
    crawl,
    stop() { stopRequested = true; },
    async status(): Promise<CrawlStatus> {
      if (!status.running && !status.lastRun) {
        const s = await readJson<State>('state.json');
        if (s?.lastRun) status.lastRun = s.lastRun;
      }
      return status;
    },
    /** The 30-day rollup, or undefined before the first crawl. */
    async rollup(): Promise<CommunityRollup | undefined> {
      await loadRollups();
      return current;
    },
    /** Usage for one weapon: the last 30 days, plus a per-month summary for trends. */
    async weapon(itemHash: number) {
      await loadRollups();
      const trend = Object.entries(history ?? {}).map(([m, r]) => ({
        month: m,
        roles: (r.weapons[itemHash]?.roles ?? []).map((x) => ({ role: x.role, copies: x.copies, shareOfRole: x.shareOfRole })),
      }));
      return { builtAt: current?.builtAt, samples: current?.samples ?? 0, weapon: current?.weapons[itemHash] ?? null, trend };
    },
    /**
     * Runs a crawl once a day at `hour` (local time) while the server is up. Checks every 5 minutes,
     * so it starts between :00 and :05. Logs the plan at startup and every skip, so a missed night
     * shows up in `docker logs` with its reason.
     */
    schedule(hour: number, opts?: CrawlOptions) {
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        logError(`COMMUNITY_CRAWL_HOUR must be a whole hour from 0 to 23, not "${hour}". The nightly crawl is off.`);
        return () => {};
      }
      const zone = deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
      const tz = process.env.TZ;
      if (!deps.timeZone && tz && tz !== zone) {
        logError(`TZ="${tz}" isn't a time zone this server knows, so hours are in ${zone}. Use a name like America/Los_Angeles.`);
      }
      const next = () => {
        const d = new Date(now());
        d.setMinutes(0, 0, 0);
        // Step an hour at a time (not set hours) so daylight-saving changes can't skip a day.
        do d.setTime(d.getTime() + 3_600_000); while (d.getHours() !== hour);
        return d;
      };
      log(`Nightly crawl scheduled for ${String(hour).padStart(2, '0')}:00 ${zone}${!deps.timeZone && !tz ? ' (TZ is not set)' : ''} (server time now ${timeOf(now())}). Next run: ${timeOf(next())}.`);
      let lastDay = '';
      const tick = () => {
        const d = now();
        const day = d.toDateString();
        if (d.getHours() !== hour || day === lastDay) return;
        lastDay = day;
        if (status.running) {
          log(`Nightly crawl skipped: a crawl has been running since ${status.startedAt}.`);
          return;
        }
        run(1);
      };
      // A run that fails before it gets going (Bungie or the network is down) tries again
      // 15 minutes later, up to 3 tries in all. A run that got going and then failed is not retried.
      const run = (attempt: number) => {
        crawl(opts, 'schedule')
          .then((r) => {
            if (r.error && r.requests < 10 && attempt < 3) {
              log(`Nightly crawl will try again in 15 minutes (try ${attempt + 1} of 3).`);
              setTimeout(() => run(attempt + 1), 15 * 60_000).unref();
            } else log(`Next nightly crawl: ${timeOf(next())}.`);
          })
          .catch((e) => logError('Nightly crawl failed:', e));
      };
      const t = setInterval(tick, 5 * 60_000);
      t.unref();
      return () => clearInterval(t);
    },
  };
}
export type Community = ReturnType<typeof createCommunity>;

class StopCrawl extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Bungie didn't answer within ${ms / 1000} seconds.`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
