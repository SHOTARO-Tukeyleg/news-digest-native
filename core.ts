/* Pure logic (no React Native imports) — RSS parsing, URL building,
   tokenization, interest-learning scoring. Unit-testable under Node. */
import { COUNTRIES, GROWTH_QUERY, type Cat } from "./data";

export type Article = {
  id: string;
  title: string;
  source: string;
  link: string;
  date: number;
  desc: string;
  related: { title: string; link: string }[];
  cat: Cat;
  country: string;
  lang: string;
};

export type Weights = { cats: Record<string, number>; kws: Record<string, number>; ts: number };
export const emptyWeights = (): Weights => ({ cats: {}, kws: {}, ts: Date.now() });

/* ---------- editions & URLs ---------- */
export function editionFor(countryCode: string, newsLang: string) {
  const c = COUNTRIES.find((x) => x.code === countryCode);
  if (!c) return null;
  const lang = newsLang !== "auto" && c.ed[newsLang] ? newsLang : c.def;
  const e = c.ed[lang];
  return { hl: e.hl, gl: c.code, ceid: e.ceid, lang };
}

export function gnUrl(ed: { hl: string; gl: string; ceid: string; lang: string }, cat: Cat): string {
  const q = `hl=${encodeURIComponent(ed.hl)}&gl=${ed.gl}&ceid=${encodeURIComponent(ed.ceid)}`;
  if (cat === "TOP") return `https://news.google.com/rss?${q}`;
  if (cat === "GROWTH") {
    const gq = GROWTH_QUERY[ed.lang] || GROWTH_QUERY.en;
    return `https://news.google.com/rss/search?q=${encodeURIComponent(gq)}&${q}`;
  }
  return `https://news.google.com/rss/headlines/section/topic/${cat}?${q}`;
}

/* ---------- tiny RSS parser (regex-based, no DOM needed) ---------- */
export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function tagContent(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

export type RawItem = { title: string; link: string; pubDate: string; description: string; source: string };

export function parseRssItems(xml: string): RawItem[] {
  const items: RawItem[] = [];
  const blocks = xml.split(/<item(?:\s[^>]*)?>/).slice(1);
  for (const b of blocks) {
    const block = b.split("</item>")[0];
    items.push({
      title: decodeEntities(tagContent(block, "title")),
      link: decodeEntities(tagContent(block, "link")),
      pubDate: tagContent(block, "pubDate"),
      description: decodeEntities(tagContent(block, "description")),
      source: decodeEntities(tagContent(block, "source")),
    });
  }
  return items.filter((i) => i.title);
}

export function extractRelated(descHtml: string): { title: string; link: string }[] {
  const out: { title: string; link: string }[] = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(descHtml)) && out.length < 6) {
    const title = stripTags(m[2]);
    if (title.length > 8) out.push({ title, link: decodeEntities(m[1]) });
  }
  return out;
}

export function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "a" + (h >>> 0).toString(36);
}

export const srcFromTitle = (t: string) => {
  const m = (t || "").match(/ - ([^-]{2,40})$/);
  return m ? m[1].trim() : "";
};
export const cleanTitle = (t: string) => (t || "").replace(/ - [^-]{2,40}$/, "").trim();

export function normalizeItem(raw: RawItem, meta: { cat: Cat; country: string; lang: string }): Article {
  return {
    id: hashId(raw.link || raw.title),
    title: cleanTitle(raw.title),
    source: raw.source || srcFromTitle(raw.title) || "",
    link: raw.link,
    date: raw.pubDate ? new Date(raw.pubDate).getTime() : Date.now(),
    desc: stripTags(raw.description || "").slice(0, 400),
    related: extractRelated(raw.description || ""),
    cat: meta.cat,
    country: meta.country,
    lang: meta.lang,
  };
}

/* ---------- tokenizer (Latin words + CJK bigrams; Hermes has no Intl.Segmenter) ---------- */
const STOP = new Set([
  "the", "of", "to", "in", "on", "for", "and", "or", "is", "are", "was", "be", "with", "at", "by",
  "from", "as", "that", "this", "it", "its", "new", "says", "say", "after", "over", "amid", "how",
  "why", "what", "who", "will", "ため", "こと", "もの", "する", "した", "ない", "これ", "それ",
]);

export function tokenize(text: string): string[] {
  const toks: string[] = [];
  const runs = text.toLowerCase().match(/[a-z0-9]{2,}|[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7a3]+/g) || [];
  for (const run of runs) {
    if (/^[a-z0-9]/.test(run)) {
      if (!STOP.has(run) && !/^\d+$/.test(run)) toks.push(run);
    } else {
      if (run.length <= 4 && run.length >= 2 && !STOP.has(run)) toks.push(run);
      for (let i = 0; i + 2 <= run.length && toks.length < 24; i++) {
        const bg = run.slice(i, i + 2);
        if (!STOP.has(bg)) toks.push(bg);
      }
    }
    if (toks.length >= 24) break;
  }
  return toks.slice(0, 24);
}

/* ---------- interest learning ---------- */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function applyDecay(w: Weights): Weights {
  const days = (Date.now() - (w.ts || Date.now())) / 86400000;
  if (days <= 0.1) return w;
  const f = Math.pow(0.97, days);
  for (const k in w.cats) w.cats[k] *= f;
  for (const k in w.kws) {
    w.kws[k] *= f;
    if (Math.abs(w.kws[k]) < 0.05) delete w.kws[k];
  }
  w.ts = Date.now();
  return w;
}

export function learn(w: Weights, a: Article, delta: number): Weights {
  w.cats[a.cat] = clamp((w.cats[a.cat] || 0) + delta, -6, 10);
  tokenize(a.title).slice(0, 8).forEach((t) => {
    w.kws[t] = clamp((w.kws[t] || 0) + delta * 0.4, -4, 6);
  });
  return w;
}

export function scoreArticle(w: Weights, a: Article): number {
  let s = (w.cats[a.cat] || 0) * 1.6;
  let kw = 0;
  tokenize(a.title).forEach((t) => (kw += w.kws[t] || 0));
  s += clamp(kw, -5, 8);
  const ageH = (Date.now() - a.date) / 3600000;
  s += Math.max(0, 3 - ageH / 8);
  return s;
}

export function dedupeSort(list: Article[], w: Weights, hidden: Set<string>): Article[] {
  const seen = new Set<string>();
  const out = list.filter((a) => {
    const k = a.title.slice(0, 60);
    if (seen.has(k) || hidden.has(a.id)) return false;
    seen.add(k);
    return true;
  });
  out.sort((x, y) => scoreArticle(w, y) - scoreArticle(w, x));
  return out;
}
