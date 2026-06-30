/**
 * VeteransLedger · Shared i18n constants
 * Single source of truth for supported locales and their flag SVGs, used by
 * both the Admin TranslationsPanel and the public-facing LanguageSwitcher.
 *
 * English is always the source language: it is never stored as a row in the
 * translations table (see src/modules/translations/translations.service.ts),
 * but it is still listed here as a selectable "Original" option for display.
 */

export const SUPPORTED_LOCALES = ["de", "es", "ru", "ar"];

export const LANGUAGES = [
  { code: "en", name: "English", isSource: true },
  { code: "de", name: "German",  isSource: false },
  { code: "es", name: "Spanish", isSource: false },
  { code: "ru", name: "Russian", isSource: false },
  { code: "ar", name: "Arabic",  isSource: false, rtl: true },
];

// Raw flag SVG markup — no size/class baked in. Wrap in your own container
// and size via CSS (e.g. `.your-flag-wrapper svg { width:20px; height:14px; }`).
export const FLAG_SVGS = {
  en: `<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="60" height="40" fill="#012169"/>
    <path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" stroke-width="8"/>
    <path d="M0,0 L60,40 M60,0 L0,40" stroke="#C8102E" stroke-width="5"/>
    <path d="M30,0 V40 M0,20 H60" stroke="#fff" stroke-width="14"/>
    <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" stroke-width="8"/>
  </svg>`,

  de: `<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="60" height="40" fill="#000"/>
    <rect y="13.33" width="60" height="13.33" fill="#D00"/>
    <rect y="26.66" width="60" height="13.34" fill="#FFCE00"/>
  </svg>`,

  es: `<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="60" height="40" fill="#AA151B"/>
    <rect y="10" width="60" height="20" fill="#F1BF00"/>
  </svg>`,

  ru: `<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="60" height="40" fill="#fff"/>
    <rect y="13.33" width="60" height="13.33" fill="#0039A6"/>
    <rect y="26.66" width="60" height="13.34" fill="#D52B1E"/>
  </svg>`,

  ar: `<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="60" height="40" fill="#006C35"/>
    <rect width="10" height="40" fill="#fff"/>
    <rect x="50" width="10" height="40" fill="#D52B1E"/>
    <line x1="10" y1="20" x2="50" y2="20" stroke="#fff" stroke-width="1.2"/>
    <text x="30" y="24" font-size="8" fill="#fff" text-anchor="middle" font-family="serif">بالعربية</text>
  </svg>`,
};
