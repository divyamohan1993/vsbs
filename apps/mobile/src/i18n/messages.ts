// =============================================================================
// Mobile-app i18n message catalogue. Mirrors apps/web/messages/{en,hi}.json
// 1:1 so a string change on web propagates to mobile after a sync.
//
// We keep messages inline (rather than dynamic-importing the web package's
// JSON) because Metro/Hermes do not have JSON-as-module imports across
// workspace boundaries without extra bundler config, and React Native
// production bundles inline strings anyway.
// =============================================================================

import type { LocaleSchema } from "@vsbs/shared";
import type { z } from "zod";

export type SupportedLocale = z.infer<typeof LocaleSchema>;

export const SUPPORTED_LOCALES: ReadonlyArray<SupportedLocale> = [
  "en",
  "hi",
  "ta",
  "te",
  "bn",
  "mr",
  "gu",
  "kn",
  "ml",
  "pa",
];

export interface Messages {
  app: { name: string; tagline: string };
  a11y: { skipToContent: string; menu: string; close: string };
  demo: { banner: string };
  home: {
    bookCta: string;
    statusCta: string;
    autonomyCta: string;
    welcome: string;
    activeBooking: string;
    noActiveBooking: string;
  };
  auth: {
    title: string;
    subtitle: string;
    phoneLabel: string;
    phonePlaceholder: string;
    sendOtp: string;
    otpLabel: string;
    verify: string;
    demoCode: string;
    errors: {
      phoneInvalid: string;
      otpInvalid: string;
      networkFail: string;
    };
  };
  book: {
    title: string;
    next: string;
    back: string;
    confirm: string;
    step1: string;
    step2: string;
    step3: string;
    step4: string;
    step5: string;
  };
  status: {
    title: string;
    eta: string;
    wellbeing: string;
    minutes: string;
    waiting: string;
    live: string;
  };
  autonomy: {
    title: string;
    grantActive: string;
    grantInactive: string;
    issueGrant: string;
    revokeGrant: string;
    biometricPrompt: string;
  };
  me: {
    title: string;
    consent: string;
    erasure: string;
    erasureConfirm: string;
    signOut: string;
    locale: string;
    theme: string;
    themeLight: string;
    themeDark: string;
    themeHigh: string;
  };
  errors: {
    offline: string;
    tryAgain: string;
    permissionDenied: string;
  };
}

const en: Messages = {
  app: { name: "VSBS", tagline: "Your vehicle, served autonomously." },
  a11y: { skipToContent: "Skip to content", menu: "Open menu", close: "Close" },
  demo: { banner: "Demo mode — no real SMS or payments will be sent" },
  home: {
    bookCta: "Book service",
    statusCta: "View status",
    autonomyCta: "Autonomy dashboard",
    welcome: "Welcome back",
    activeBooking: "Active booking",
    noActiveBooking: "No active booking",
  },
  auth: {
    title: "Sign in with your phone",
    subtitle: "We send a one-time code to your number.",
    phoneLabel: "Phone number",
    phonePlaceholder: "+91...",
    sendOtp: "Send code",
    otpLabel: "Enter the code",
    verify: "Verify code",
    demoCode: "Demo code",
    errors: {
      phoneInvalid: "Enter a valid international phone number.",
      otpInvalid: "That code did not match. Try again.",
      networkFail: "Could not reach the server. Check your connection.",
    },
  },
  book: {
    title: "Book a service visit",
    next: "Continue",
    back: "Back",
    confirm: "Confirm booking",
    step1: "Sign in",
    step2: "Vehicle",
    step3: "Symptoms",
    step4: "Review",
    step5: "Concierge",
  },
  status: {
    title: "Booking status",
    eta: "ETA",
    wellbeing: "Wellbeing",
    minutes: "min",
    waiting: "Waiting for the next update.",
    live: "Live stream",
  },
  autonomy: {
    title: "Autonomy",
    grantActive: "A command grant is active.",
    grantInactive: "No command grant is active.",
    issueGrant: "Issue grant",
    revokeGrant: "Revoke grant",
    biometricPrompt: "Confirm your identity to sign the command grant.",
  },
  me: {
    title: "Profile",
    consent: "Consents",
    erasure: "Delete my data",
    erasureConfirm: "This permanently deletes your account and history. Continue?",
    signOut: "Sign out",
    locale: "Language",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeHigh: "High contrast",
  },
  errors: {
    offline: "You are offline. We will retry when the connection returns.",
    tryAgain: "Try again",
    permissionDenied: "Permission denied. Open settings to allow access.",
  },
};

const hi: Messages = {
  app: { name: "VSBS", tagline: "आपकी गाड़ी, स्वचालित रूप से सेवा प्राप्त।" },
  a11y: { skipToContent: "मुख्य सामग्री पर जाएँ", menu: "मेनू खोलें", close: "बंद करें" },
  demo: { banner: "डेमो मोड — कोई वास्तविक SMS या भुगतान नहीं भेजा जाएगा" },
  home: {
    bookCta: "सर्विस बुक करें",
    statusCta: "स्थिति देखें",
    autonomyCta: "ऑटोनॉमी डैशबोर्ड",
    welcome: "स्वागत है",
    activeBooking: "सक्रिय बुकिंग",
    noActiveBooking: "कोई सक्रिय बुकिंग नहीं",
  },
  auth: {
    title: "अपने फ़ोन से साइन इन करें",
    subtitle: "हम आपके नंबर पर एक OTP भेजते हैं।",
    phoneLabel: "फ़ोन नंबर",
    phonePlaceholder: "+91...",
    sendOtp: "कोड भेजें",
    otpLabel: "कोड दर्ज करें",
    verify: "कोड सत्यापित करें",
    demoCode: "डेमो कोड",
    errors: {
      phoneInvalid: "कृपया मान्य अंतरराष्ट्रीय फ़ोन नंबर दर्ज करें।",
      otpInvalid: "कोड मेल नहीं खाया। पुनः प्रयास करें।",
      networkFail: "सर्वर तक नहीं पहुँच सके। कनेक्शन जाँचें।",
    },
  },
  book: {
    title: "सर्विस बुक करें",
    next: "जारी रखें",
    back: "पिछला",
    confirm: "बुकिंग की पुष्टि करें",
    step1: "साइन इन",
    step2: "वाहन",
    step3: "लक्षण",
    step4: "समीक्षा",
    step5: "कन्सीयर्ज",
  },
  status: {
    title: "बुकिंग स्थिति",
    eta: "अनुमानित समय",
    wellbeing: "वेलबीइंग",
    minutes: "मिनट",
    waiting: "अगले अपडेट की प्रतीक्षा है।",
    live: "लाइव स्ट्रीम",
  },
  autonomy: {
    title: "ऑटोनॉमी",
    grantActive: "एक कमांड ग्रांट सक्रिय है।",
    grantInactive: "कोई कमांड ग्रांट सक्रिय नहीं है।",
    issueGrant: "ग्रांट जारी करें",
    revokeGrant: "ग्रांट रद्द करें",
    biometricPrompt: "ग्रांट साइन करने के लिए पहचान की पुष्टि करें।",
  },
  me: {
    title: "प्रोफ़ाइल",
    consent: "सहमतियाँ",
    erasure: "मेरा डेटा हटाएँ",
    erasureConfirm: "यह आपका खाता और इतिहास स्थायी रूप से हटा देगा। जारी रखें?",
    signOut: "साइन आउट",
    locale: "भाषा",
    theme: "थीम",
    themeLight: "हल्की",
    themeDark: "गहरी",
    themeHigh: "उच्च कंट्रास्ट",
  },
  errors: {
    offline: "आप ऑफ़लाइन हैं। कनेक्शन वापस आते ही पुनः प्रयास करेंगे।",
    tryAgain: "पुनः प्रयास करें",
    permissionDenied: "अनुमति अस्वीकृत। सेटिंग्स में अनुमति दें।",
  },
};

export const MESSAGES: Record<SupportedLocale, Messages> = {
  en,
  hi,
  ta: en,
  te: en,
  bn: en,
  mr: en,
  gu: en,
  kn: en,
  ml: en,
  pa: en,
};

export const DEFAULT_LOCALE: SupportedLocale = "en";
