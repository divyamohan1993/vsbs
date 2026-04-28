// =============================================================================
// Indic NLP pipeline.
//
// Live driver: AI4Bharat IndicTrans2 (translation), IndicBERT v2 (encoding),
// Bhashini (Govt. of India aggregator) as fallback for OOV pairs.
// References: Gala et al., 2023, "IndicTrans2: Towards High-Quality and
// Accessible Machine Translation Models for All 22 Scheduled Indian
// Languages"; Doddapaneni et al., 2023, IndicBERT v2.
//
// Sim driver (this file) implements:
//   - script detection by Unicode block range (deterministic, O(n) over text)
//   - transliteration via a fixed glossary of automotive terms
//   - pseudo-translation via the same glossary (fall through to "as-is"
//     when no entry exists; we still tag the source/target language so the
//     caller can decide whether to forward the live API)
//   - 768-dim deterministic embedding (delegates to SimBgeM3Embedder)
//
// Live and sim share the SAME `IndicPipeline` interface.
// =============================================================================

import { z } from "zod";
import { SimBgeM3Embedder, type DenseVector } from "./embeddings.js";

export const IndicLangSchema = z.enum([
  "en",
  "hi", // Hindi (Devanagari)
  "bn", // Bengali (Bangla)
  "ta", // Tamil
  "te", // Telugu
  "kn", // Kannada
  "ml", // Malayalam
  "gu", // Gujarati
  "pa", // Punjabi (Gurmukhi)
  "or", // Odia
  "as", // Assamese
  "mr", // Marathi (Devanagari)
]);
export type IndicLang = z.infer<typeof IndicLangSchema>;

export const IndicScriptSchema = z.enum([
  "Latin",
  "Devanagari",
  "Bengali",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Gujarati",
  "Gurmukhi",
  "Odia",
  "Mixed",
  "Unknown",
]);
export type IndicScript = z.infer<typeof IndicScriptSchema>;

export interface ScriptDetection {
  script: IndicScript;
  confidence: number;
  perScript: Partial<Record<IndicScript, number>>;
}

export interface IndicPipeline {
  detectScript(text: string): ScriptDetection;
  transliterate(text: string, from: IndicLang, to: IndicLang): string;
  translate(text: string, src: IndicLang, tgt: IndicLang): string;
  embed(text: string, lang: IndicLang): DenseVector;
}

// -----------------------------------------------------------------------------
// Unicode block ranges. The sim detector counts characters in each block
// and reports the dominant script + its share of characters.
//
// References (Unicode 15.1 chapter 12):
//   Devanagari : U+0900..U+097F
//   Bengali    : U+0980..U+09FF (Bangla + Assamese)
//   Gurmukhi   : U+0A00..U+0A7F (Punjabi)
//   Gujarati   : U+0A80..U+0AFF
//   Odia       : U+0B00..U+0B7F
//   Tamil      : U+0B80..U+0BFF
//   Telugu     : U+0C00..U+0C7F
//   Kannada    : U+0C80..U+0CFF
//   Malayalam  : U+0D00..U+0D7F
// -----------------------------------------------------------------------------

interface BlockRange {
  script: IndicScript;
  start: number;
  end: number;
}

const BLOCKS: BlockRange[] = [
  { script: "Devanagari", start: 0x0900, end: 0x097f },
  { script: "Bengali", start: 0x0980, end: 0x09ff },
  { script: "Gurmukhi", start: 0x0a00, end: 0x0a7f },
  { script: "Gujarati", start: 0x0a80, end: 0x0aff },
  { script: "Odia", start: 0x0b00, end: 0x0b7f },
  { script: "Tamil", start: 0x0b80, end: 0x0bff },
  { script: "Telugu", start: 0x0c00, end: 0x0c7f },
  { script: "Kannada", start: 0x0c80, end: 0x0cff },
  { script: "Malayalam", start: 0x0d00, end: 0x0d7f },
];

function classifyCodePoint(cp: number): IndicScript | null {
  if (cp >= 0x0041 && cp <= 0x007a) return "Latin";
  for (const b of BLOCKS) {
    if (cp >= b.start && cp <= b.end) return b.script;
  }
  // Latin extended (accented), still counts as Latin.
  if (cp >= 0x00c0 && cp <= 0x024f) return "Latin";
  return null;
}

// -----------------------------------------------------------------------------
// Automotive glossary — tiny but real. Used for transliteration AND
// pseudo-translation fall-through. Entries are well-known borrow words
// across north and south Indian languages; mappings are common parlance,
// not strict phonetic transliteration.
// -----------------------------------------------------------------------------

interface GlossaryEntry {
  en: string;
  hi: string;
  bn: string;
  ta: string;
  te: string;
  kn: string;
  ml: string;
  gu: string;
  pa: string;
  or: string;
  as: string;
  mr: string;
}

const GLOSSARY: GlossaryEntry[] = [
  // brake
  {
    en: "brake",
    hi: "ब्रेक",
    bn: "ব্রেক",
    ta: "பிரேக்",
    te: "బ్రేక్",
    kn: "ಬ್ರೇಕ್",
    ml: "ബ്രേക്ക്",
    gu: "બ્રેક",
    pa: "ਬ੍ਰੇਕ",
    or: "ବ୍ରେକ",
    as: "ব্ৰেক",
    mr: "ब्रेक",
  },
  // clutch
  {
    en: "clutch",
    hi: "क्लच",
    bn: "ক্লাচ",
    ta: "கிளட்ச்",
    te: "క్లచ్",
    kn: "ಕ್ಲಚ್",
    ml: "ക്ലച്ച്",
    gu: "ક્લચ",
    pa: "ਕਲੱਚ",
    or: "କ୍ଲଚ୍",
    as: "ক্লাচ",
    mr: "क्लच",
  },
  // horn
  {
    en: "horn",
    hi: "हॉर्न",
    bn: "হর্ন",
    ta: "ஹார்ன்",
    te: "హార్న్",
    kn: "ಹಾರ್ನ್",
    ml: "ഹോൺ",
    gu: "હોર્ન",
    pa: "ਹੌਰਨ",
    or: "ହର୍ନ",
    as: "হৰ্ণ",
    mr: "हॉर्न",
  },
  // headlight
  {
    en: "headlight",
    hi: "हेडलाइट",
    bn: "হেডলাইট",
    ta: "ஹெட்லைட்",
    te: "హెడ్‌లైట్",
    kn: "ಹೆಡ್‌ಲೈಟ್",
    ml: "ഹെഡ്‌ലൈറ്റ്",
    gu: "હેડલાઇટ",
    pa: "ਹੈੱਡਲਾਈਟ",
    or: "ହେଡଲାଇଟ",
    as: "হেডলাইট",
    mr: "हेडलाईट",
  },
  // engine
  {
    en: "engine",
    hi: "इंजन",
    bn: "ইঞ্জিন",
    ta: "என்ஜின்",
    te: "ఇంజిన్",
    kn: "ಇಂಜಿನ್",
    ml: "എൻജിൻ",
    gu: "એન્જિન",
    pa: "ਇੰਜਣ",
    or: "ଇଞ୍ଜିନ",
    as: "ইঞ্জিন",
    mr: "इंजिन",
  },
  // battery
  {
    en: "battery",
    hi: "बैटरी",
    bn: "ব্যাটারি",
    ta: "பேட்டரி",
    te: "బ్యాటరీ",
    kn: "ಬ್ಯಾಟರಿ",
    ml: "ബാറ്ററി",
    gu: "બેટરી",
    pa: "ਬੈਟਰੀ",
    or: "ବ୍ୟାଟେରୀ",
    as: "বেটাৰি",
    mr: "बॅटरी",
  },
  // tyre
  {
    en: "tyre",
    hi: "टायर",
    bn: "টায়ার",
    ta: "டயர்",
    te: "టైర్",
    kn: "ಟೈರ್",
    ml: "ടയർ",
    gu: "ટાયર",
    pa: "ਟਾਇਰ",
    or: "ଟାୟାର",
    as: "টায়াৰ",
    mr: "टायर",
  },
  // service
  {
    en: "service",
    hi: "सर्विस",
    bn: "সার্ভিস",
    ta: "சர்வீஸ்",
    te: "సర్వీస్",
    kn: "ಸರ್ವೀಸ್",
    ml: "സർവീസ്",
    gu: "સર્વિસ",
    pa: "ਸਰਵਿਸ",
    or: "ସର୍ଭିସ",
    as: "চাৰ্ভিচ",
    mr: "सर्व्हिस",
  },
  // booking
  {
    en: "booking",
    hi: "बुकिंग",
    bn: "বুকিং",
    ta: "புக்கிங்",
    te: "బుకింగ్",
    kn: "ಬುಕಿಂಗ್",
    ml: "ബുക്കിംഗ്",
    gu: "બુકિંગ",
    pa: "ਬੁਕਿੰਗ",
    or: "ବୁକିଂ",
    as: "বুকিং",
    mr: "बुकिंग",
  },
  // car
  {
    en: "car",
    hi: "कार",
    bn: "গাড়ি",
    ta: "கார்",
    te: "కారు",
    kn: "ಕಾರ್",
    ml: "കാർ",
    gu: "કાર",
    pa: "ਕਾਰ",
    or: "କାର",
    as: "গাড়ী",
    mr: "कार",
  },
];

const GLOSSARY_INDEX: Map<string, GlossaryEntry> = (() => {
  const m = new Map<string, GlossaryEntry>();
  for (const e of GLOSSARY) {
    for (const key of [e.en, e.hi, e.bn, e.ta, e.te, e.kn, e.ml, e.gu, e.pa, e.or, e.as, e.mr]) {
      const norm = key.toLowerCase().normalize("NFKC");
      if (!m.has(norm)) m.set(norm, e);
    }
  }
  return m;
})();

// -----------------------------------------------------------------------------
// Sim driver
// -----------------------------------------------------------------------------

export class SimIndicPipeline implements IndicPipeline {
  readonly #embedder = new SimBgeM3Embedder();

  detectScript(text: string): ScriptDetection {
    const counts: Partial<Record<IndicScript, number>> = {};
    let total = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      const sc = classifyCodePoint(cp);
      if (!sc) continue;
      counts[sc] = (counts[sc] ?? 0) + 1;
      total += 1;
    }
    if (total === 0) {
      return { script: "Unknown", confidence: 0, perScript: {} };
    }
    let bestScript: IndicScript = "Unknown";
    let bestCount = 0;
    let nonZero = 0;
    for (const [k, v] of Object.entries(counts)) {
      if ((v ?? 0) > 0) nonZero += 1;
      if ((v ?? 0) > bestCount) {
        bestCount = v ?? 0;
        bestScript = k as IndicScript;
      }
    }
    const confidence = total === 0 ? 0 : bestCount / total;
    const script: IndicScript = nonZero > 1 && confidence < 0.85 ? "Mixed" : bestScript;
    return { script, confidence, perScript: counts };
  }

  transliterate(text: string, from: IndicLang, to: IndicLang): string {
    if (from === to) return text;
    return this.translateOrTransliterate(text, from, to);
  }

  translate(text: string, src: IndicLang, tgt: IndicLang): string {
    if (src === tgt) return text;
    return this.translateOrTransliterate(text, src, tgt);
  }

  embed(text: string, _lang: IndicLang): DenseVector {
    void _lang;
    return this.#embedder.embed(text).dense;
  }

  // Whole-word glossary substitution. Tokens that have no glossary entry
  // pass through unchanged so the caller can route them to the live API.
  private translateOrTransliterate(text: string, _src: IndicLang, tgt: IndicLang): string {
    void _src;
    const out: string[] = [];
    let buf = "";
    for (const ch of text) {
      if (/\s|[\p{P}]/u.test(ch)) {
        if (buf) {
          out.push(this.lookup(buf, tgt));
          buf = "";
        }
        out.push(ch);
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(this.lookup(buf, tgt));
    return out.join("");
  }

  private lookup(token: string, tgt: IndicLang): string {
    const norm = token.toLowerCase().normalize("NFKC");
    const entry = GLOSSARY_INDEX.get(norm);
    if (!entry) return token;
    return entry[tgt];
  }
}

// Convenience factory; the live wiring would inspect env and either
// instantiate a `LiveIndicPipeline` (REST client) or return this sim driver.
export function makeIndicPipeline(opts?: { mode?: "sim" | "live" }): IndicPipeline {
  // The live driver lives in `indic-live.ts` (out of scope of this Phase 3
  // sim build; promotion is a single-line constructor swap). The `mode`
  // parameter is reserved so call sites can be written today.
  void opts;
  return new SimIndicPipeline();
}
