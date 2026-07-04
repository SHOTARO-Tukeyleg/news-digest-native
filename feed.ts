/* Feed fetching with cache.
   Native fetch has no CORS restriction, so Google News RSS is fetched
   DIRECTLY first; rss2json is kept only as a fallback. */
import { type Cat } from "./data";
import { Article, editionFor, gnUrl, normalizeItem, parseRssItems, type RawItem } from "./core";
import { jget, jset } from "./storage";

const FRESH_MS = 15 * 60 * 1000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(to); res(v); },
      (e) => { clearTimeout(to); rej(e); }
    );
  });
}

async function fetchDirect(url: string): Promise<RawItem[]> {
  const r = await withTimeout(fetch(url, { headers: { Accept: "application/rss+xml, application/xml, text/xml" } }), 12000);
  if (!r.ok) throw new Error("http " + r.status);
  const items = parseRssItems(await r.text());
  if (!items.length) throw new Error("no items");
  return items;
}

async function fetchRss2json(url: string): Promise<RawItem[]> {
  const r = await withTimeout(fetch("https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(url)), 20000);
  if (!r.ok) throw new Error("http " + r.status);
  const j = await r.json();
  if (j.status !== "ok" || !Array.isArray(j.items)) throw new Error("bad payload");
  return j.items.map((it: any): RawItem => ({
    title: it.title || "",
    link: it.link || "",
    pubDate: it.pubDate || "",
    description: it.description || "",
    source: it.author || "",
  }));
}

export type FetchResult = { items: Article[]; fromCache: boolean };

export async function fetchFeed(country: string, cat: Cat, newsLang: string, force: boolean): Promise<FetchResult> {
  const ed = editionFor(country, newsLang);
  if (!ed) return { items: [], fromCache: false };
  const url = gnUrl(ed, cat);
  const cacheKey = `feed:${country}:${cat}:${ed.lang}`;
  const cached = await jget<{ ts: number; items: Article[] }>(cacheKey);
  if (cached && !force && Date.now() - cached.ts < FRESH_MS) return { items: cached.items, fromCache: true };

  const meta = { cat, country, lang: ed.lang };
  for (const strat of [fetchDirect, fetchRss2json]) {
    try {
      const raw = await strat(url);
      const items = raw.map((r) => normalizeItem(r, meta)).filter((a) => a.title);
      if (items.length) {
        void jset(cacheKey, { ts: Date.now(), items });
        return { items, fromCache: false };
      }
    } catch {
      /* try next strategy */
    }
  }
  return { items: cached ? cached.items : [], fromCache: true };
}

export async function fetchMany(countries: string[], cats: Cat[], newsLang: string, force: boolean): Promise<{ items: Article[]; anyCache: boolean }> {
  const jobs: Promise<FetchResult>[] = [];
  for (const c of countries) for (const cat of cats) jobs.push(fetchFeed(c, cat, newsLang, force));
  const res = await Promise.all(jobs);
  return { items: res.flatMap((r) => r.items), anyCache: res.some((r) => r.fromCache) };
}
