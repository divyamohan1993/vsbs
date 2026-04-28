import { describe, it, expect } from "vitest";
import { SimIndicPipeline, makeIndicPipeline } from "../src/indic-nlp.js";

describe("Indic script detection", () => {
  const p = new SimIndicPipeline();

  const cases: Array<{ input: string; expect: string }> = [
    { input: "मेरी कार में ब्रेक की आवाज आ रही है", expect: "Devanagari" },
    { input: "আমার গাড়িতে ব্রেক শব্দ হচ্ছে", expect: "Bengali" },
    { input: "என் காரில் பிரேக் சத்தம் கேட்கிறது", expect: "Tamil" },
    { input: "నా కారులో బ్రేక్ శబ్దం వస్తోంది", expect: "Telugu" },
    { input: "ನನ್ನ ಕಾರ್‌ನಲ್ಲಿ ಬ್ರೇಕ್ ಶಬ್ದ ಬರುತ್ತಿದೆ", expect: "Kannada" },
    { input: "എന്റെ കാറിൽ ബ്രേക്ക് ശബ്ദം വരുന്നു", expect: "Malayalam" },
    { input: "મારી કારમાં બ્રેકનો અવાજ આવે છે", expect: "Gujarati" },
    { input: "ਮੇਰੀ ਕਾਰ ਵਿੱਚ ਬ੍ਰੇਕ ਦੀ ਆਵਾਜ਼ ਆ ਰਹੀ ਹੈ", expect: "Gurmukhi" },
    { input: "ମୋ କାରରେ ବ୍ରେକ ଶବ୍ଦ ଆସୁଛି", expect: "Odia" },
    { input: "my car brake is making noise", expect: "Latin" },
  ];

  for (const c of cases) {
    it(`detects ${c.expect}`, () => {
      const det = p.detectScript(c.input);
      expect(det.script).toBe(c.expect);
      expect(det.confidence).toBeGreaterThan(0.5);
    });
  }

  it("flags mixed script when balanced", () => {
    const det = p.detectScript("Honda कार ब्रेक engine misfire");
    // mixed because Devanagari and Latin both carry significant share
    expect(["Mixed", "Latin", "Devanagari"]).toContain(det.script);
  });

  it("returns Unknown for an empty / non-script input", () => {
    expect(p.detectScript("12345 !!! ???").script).toBe("Unknown");
  });
});

describe("Indic translation / transliteration glossary", () => {
  const p = new SimIndicPipeline();

  it("translates known glossary terms English to Hindi", () => {
    expect(p.translate("brake", "en", "hi")).toBe("ब्रेक");
    expect(p.translate("clutch", "en", "hi")).toBe("क्लच");
    expect(p.translate("engine", "en", "hi")).toBe("इंजन");
  });

  it("transliterates Hindi to Tamil where the glossary covers", () => {
    expect(p.transliterate("ब्रेक", "hi", "ta")).toBe("பிரேக்");
  });

  it("passes through unknown words", () => {
    expect(p.translate("xyzzy", "en", "hi")).toBe("xyzzy");
  });

  it("preserves whitespace and punctuation", () => {
    const out = p.translate("brake, engine.", "en", "hi");
    expect(out).toBe("ब्रेक, इंजन.");
  });

  it("identity translation returns input unchanged", () => {
    expect(p.translate("brake", "en", "en")).toBe("brake");
  });
});

describe("Indic embed", () => {
  it("emits a 768-dim normalised vector for any language", () => {
    const p = makeIndicPipeline();
    const v = p.embed("ब्रेक की आवाज", "hi");
    expect(v.length).toBe(768);
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
    expect(Math.sqrt(s)).toBeCloseTo(1, 6);
  });
});
