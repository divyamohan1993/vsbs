

import { DEFAULT_LOCALE, MESSAGES, SUPPORTED_LOCALES } from "../src/i18n/messages";

describe("i18n messages", () => {
  it("default locale is en", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("supports all 10 LocaleSchema values", () => {
    expect(SUPPORTED_LOCALES.length).toBe(10);
  });

  it("English and Hindi catalogues both expose required keys", () => {
    const required: Array<keyof (typeof MESSAGES)["en"]> = [
      "app",
      "a11y",
      "demo",
      "home",
      "auth",
      "book",
      "status",
      "autonomy",
      "me",
      "errors",
    ];
    for (const k of required) {
      expect(MESSAGES.en[k]).toBeDefined();
      expect(MESSAGES.hi[k]).toBeDefined();
    }
  });

  it("Hindi catalogue does not contain plain Latin auth title (sanity check)", () => {
    expect(MESSAGES.hi.auth.title).not.toBe(MESSAGES.en.auth.title);
  });

  it("every supported locale resolves to a Messages object", () => {
    for (const l of SUPPORTED_LOCALES) {
      expect(MESSAGES[l]).toBeDefined();
      expect(MESSAGES[l].app.name).toBe("VSBS");
    }
  });
});
