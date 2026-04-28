// =============================================================================
// DPIA + FRIA generator.
//
// Reads docs/compliance/dpia.md and docs/compliance/fria.md, parses optional
// YAML-style frontmatter to extract structured fields, and surfaces both the
// raw markdown and the structured payload (Zod-validated). Live integrations
// can render this into the operator dashboard or attach it to a regulator
// submission packet.
//
// We keep the parser tiny and dependency-free; the frontmatter is the
// operator's machine-readable contract, the markdown remains the
// authoritative human document.
// =============================================================================

import { z } from "zod";

export const RiskSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(8),
  inherent: z.enum(["Low", "Medium", "High", "Critical"]),
  controls: z.array(z.string()).default([]),
  residual: z.enum(["Low", "Medium", "High", "Critical"]),
  owner: z.string().optional(),
});
export type Risk = z.infer<typeof RiskSchema>;

export const FrontmatterSchema = z.object({
  type: z.enum(["DPIA", "FRIA"]),
  system: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  date: z.string().min(8),
  author: z.string().min(1),
  regulatory_basis: z.array(z.string()).default([]),
  risks: z.array(RiskSchema).default([]),
  signoff_required: z.array(z.string()).default([]),
});
export type Frontmatter = z.infer<typeof FrontmatterSchema>;

export interface AssessmentDocument {
  type: "DPIA" | "FRIA";
  frontmatter: Frontmatter | null;
  markdown: string;
  signoff_required: string[];
  risks: Risk[];
}

export function parseFrontmatter(source: string): { fm: Frontmatter | null; rest: string } {
  if (!source.startsWith("---\n")) return { fm: null, rest: source };
  const end = source.indexOf("\n---", 4);
  if (end < 0) return { fm: null, rest: source };
  const block = source.slice(4, end);
  const rest = source.slice(end + 4).replace(/^\n+/, "");
  const obj = parseYamlSubset(block);
  const parsed = FrontmatterSchema.safeParse(obj);
  if (!parsed.success) {
    throw new Error(`Frontmatter invalid: ${parsed.error.message}`);
  }
  return { fm: parsed.data, rest };
}

function parseYamlSubset(block: string): unknown {
  const root: Record<string, unknown> = {};
  const lines = block.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1] as string;
    const rawVal = (m[2] ?? "").trim();
    if (rawVal !== "") {
      root[key] = parseScalar(rawVal);
      i += 1;
      continue;
    }
    const block2: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j] ?? "";
      if (l.length === 0) {
        j += 1;
        continue;
      }
      if (!l.startsWith("  ") && !l.startsWith("\t")) break;
      block2.push(l);
      j += 1;
    }
    root[key] = parseBlock(block2);
    i = j;
  }
  return root;
}

function parseScalar(s: string): string | number | boolean {
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseBlock(lines: string[]): unknown {
  if (lines.length === 0) return [];
  const stripped = lines.map((l) => l.replace(/^  /, ""));
  if (stripped[0]?.trimStart().startsWith("- ")) {
    return parseObjectList(stripped);
  }
  return parseYamlSubset(stripped.join("\n"));
}

function parseObjectList(lines: string[]): unknown[] {
  const items: unknown[] = [];
  let cur: string[] | null = null;
  for (const l of lines) {
    if (l.startsWith("- ")) {
      if (cur) items.push(parseListItem(cur));
      cur = [l.slice(2)];
    } else if (cur) {
      cur.push(l.replace(/^  /, ""));
    }
  }
  if (cur) items.push(parseListItem(cur));
  return items;
}

function parseListItem(lines: string[]): unknown {
  const first = lines[0] ?? "";
  if (!/^[A-Za-z_]/.test(first) || !first.includes(":")) {
    return parseScalar(first.trim());
  }
  return parseYamlSubset(lines.join("\n"));
}

export interface AssessmentSource {
  read(path: string): Promise<string>;
}

export interface DpiaGeneratorOptions {
  source: AssessmentSource;
  dpiaPath: string;
  friaPath: string;
}

export class DpiaGenerator {
  readonly #opts: DpiaGeneratorOptions;
  constructor(opts: DpiaGeneratorOptions) {
    this.#opts = opts;
  }

  async generateDPIA(): Promise<AssessmentDocument> {
    return this.#load("DPIA", this.#opts.dpiaPath);
  }

  async generateFRIA(): Promise<AssessmentDocument> {
    return this.#load("FRIA", this.#opts.friaPath);
  }

  async generate(scope: "DPIA" | "FRIA"): Promise<AssessmentDocument> {
    return scope === "DPIA" ? this.generateDPIA() : this.generateFRIA();
  }

  async #load(kind: "DPIA" | "FRIA", path: string): Promise<AssessmentDocument> {
    const raw = await this.#opts.source.read(path);
    const { fm, rest } = parseFrontmatter(raw);
    return {
      type: kind,
      frontmatter: fm,
      markdown: rest,
      signoff_required: fm?.signoff_required ?? [],
      risks: fm?.risks ?? [],
    };
  }
}

export interface FsLike {
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

export function fsAssessmentSource(fs: FsLike): AssessmentSource {
  return {
    read: async (path: string) => fs.readFile(path, "utf8"),
  };
}

export function inMemoryAssessmentSource(files: Record<string, string>): AssessmentSource {
  return {
    read: async (p: string) => {
      const v = files[p];
      if (v === undefined) throw new Error(`No such file: ${p}`);
      return v;
    },
  };
}
