// Tiny client-side search index for the help centre. Tokenises the
// articles into lowercase words, drops a small stop-word set, and
// stores an inverted index from token to (slug, term-frequency). Match
// scoring is TF-IDF: idf weights down common words, tf rewards matches
// in shorter documents. Query matching is AND across query tokens.
//
// We don't take a Lunr dependency because the article corpus is ~2KB —
// the algorithm in this file is O(N · log V) and is verifiable in a
// single page of code.

import { HELP_ARTICLES, type HelpArticle } from "../content/help";

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "we", "our", "you", "your", "to", "of",
  "and", "or", "in", "on", "at", "by", "for", "with", "from", "this",
  "that", "it", "be", "as", "have", "has", "if", "then", "but", "so",
  "do", "does", "did", "not", "no",
]);

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[`*_~#>]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface DocStats {
  slug: string;
  termCount: number;
  termFreq: Map<string, number>;
}

interface Index {
  docs: DocStats[];
  postings: Map<string, { slug: string; tf: number }[]>;
  idf: Map<string, number>;
}

function buildIndex(articles: HelpArticle[]): Index {
  const docs: DocStats[] = [];
  const postings = new Map<string, { slug: string; tf: number }[]>();
  for (const art of articles) {
    const tokens = tokenise(`${art.title} ${art.body}`);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    docs.push({ slug: art.slug, termCount: tokens.length, termFreq: tf });
    for (const [term, count] of tf) {
      const list = postings.get(term);
      if (list) list.push({ slug: art.slug, tf: count });
      else postings.set(term, [{ slug: art.slug, tf: count }]);
    }
  }
  const idf = new Map<string, number>();
  const N = docs.length;
  for (const [term, list] of postings) {
    idf.set(term, Math.log(1 + N / (1 + list.length)));
  }
  return { docs, postings, idf };
}

const INDEX = buildIndex(HELP_ARTICLES);

export interface HelpSearchResult {
  slug: string;
  title: string;
  excerpt: string;
  score: number;
}

export function searchHelp(query: string, max = 8): HelpSearchResult[] {
  const tokens = tokenise(query);
  if (tokens.length === 0) return [];
  const scoreBySlug = new Map<string, number>();
  for (const tok of tokens) {
    const list = INDEX.postings.get(tok);
    if (!list) continue;
    const w = INDEX.idf.get(tok) ?? 0;
    for (const { slug, tf } of list) {
      const doc = INDEX.docs.find((d) => d.slug === slug);
      const norm = doc ? tf / Math.max(1, doc.termCount) : 0;
      const prev = scoreBySlug.get(slug) ?? 0;
      scoreBySlug.set(slug, prev + w * norm);
    }
  }
  const ranked = Array.from(scoreBySlug.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);
  return ranked
    .map(([slug, score]) => {
      const art = HELP_ARTICLES.find((a) => a.slug === slug);
      if (!art) return null;
      return { slug, title: art.title, excerpt: makeExcerpt(art.body, tokens), score };
    })
    .filter((r): r is HelpSearchResult => r !== null);
}

function makeExcerpt(body: string, tokens: string[]): string {
  const text = body.replace(/^#.*$/gm, "").replace(/\n+/g, " ").trim();
  const lower = text.toLowerCase();
  for (const tok of tokens) {
    const idx = lower.indexOf(tok);
    if (idx >= 0) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(text.length, idx + 120);
      const slice = text.slice(start, end);
      return (start > 0 ? "…" : "") + slice + (end < text.length ? "…" : "");
    }
  }
  return text.slice(0, 180) + (text.length > 180 ? "…" : "");
}
