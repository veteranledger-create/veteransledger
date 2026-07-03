import { AppError } from "../../middleware/error.middleware";

/**
 * VeteransLedger · Translation provider abstraction
 *
 * The engine never depends on a specific vendor. The active provider is
 * resolved from configuration at call time:
 *
 *   TRANSLATION_PROVIDER = libretranslate | deepl | google | openai
 *
 * or, when TRANSLATION_PROVIDER is unset, auto-detected from whichever
 * provider credentials are present (first match in PROVIDER_ORDER below).
 * When nothing is configured, resolveProvider() returns null and the
 * application disables automatic translation gracefully — manual editing
 * is unaffected.
 *
 * Adding a future provider = implement TranslationProvider, register it in
 * FACTORIES/PROVIDER_ORDER. No application code changes.
 *
 * Error contract: translate() either returns real translated text or throws
 * an AppError with an administrator-friendly message (no URLs, keys, or env
 * variable names). Technical details are logged server-side only.
 */

export interface TranslationProvider {
  /** Short vendor id, e.g. "deepl" — safe to show in the Admin UI. */
  readonly name: string;
  translate(text: string, targetLocale: string): Promise<string>;
}

const UNAVAILABLE = () =>
  new AppError(502, "The machine translation service is unavailable right now. No translation was stored.");

function logProviderError(provider: string, detail: unknown): void {
  // Ops-facing detail stays in the server log; admins get the friendly error.
  console.error(`[translations] ${provider} provider error:`, detail);
}

async function postJson(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    logProviderError(provider, err);
    throw UNAVAILABLE();
  }
  if (!res.ok) {
    logProviderError(provider, `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    throw UNAVAILABLE();
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function requireText(provider: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    logProviderError(provider, "empty translation in response");
    throw UNAVAILABLE();
  }
  return value;
}

// ── LibreTranslate (self-hosted) ─────────────────────────────────────────────

class LibreTranslateProvider implements TranslationProvider {
  readonly name = "libretranslate";
  constructor(private readonly url: string, private readonly apiKey?: string) {}

  async translate(text: string, targetLocale: string): Promise<string> {
    const data = await postJson(this.name, `${this.url}/translate`, {
      q: text, source: "en", target: targetLocale, format: "text",
      ...(this.apiKey ? { api_key: this.apiKey } : {}),
    });
    return requireText(this.name, data.translatedText);
  }
}

// ── DeepL ────────────────────────────────────────────────────────────────────

const DEEPL_TARGETS: Record<string, string> = {
  de: "DE", ja: "JA", it: "IT", ru: "RU", es: "ES", fr: "FR", uk: "UK", ar: "AR",
};

class DeepLProvider implements TranslationProvider {
  readonly name = "deepl";
  constructor(private readonly apiKey: string) {}

  async translate(text: string, targetLocale: string): Promise<string> {
    // Free-tier keys end in ":fx" and use the api-free host.
    const host = this.apiKey.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
    const target = DEEPL_TARGETS[targetLocale];
    if (!target) throw UNAVAILABLE();
    const data = await postJson(this.name, `https://${host}/v2/translate`, {
      text: [text], source_lang: "EN", target_lang: target,
    }, { Authorization: `DeepL-Auth-Key ${this.apiKey}` });
    const first = (data.translations as Array<{ text?: string }> | undefined)?.[0];
    return requireText(this.name, first?.text);
  }
}

// ── Google Cloud Translation (v2 REST) ──────────────────────────────────────

class GoogleTranslateProvider implements TranslationProvider {
  readonly name = "google";
  constructor(private readonly apiKey: string) {}

  async translate(text: string, targetLocale: string): Promise<string> {
    const data = await postJson(
      this.name,
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(this.apiKey)}`,
      { q: text, source: "en", target: targetLocale, format: "text" },
    );
    const first = (data.data as { translations?: Array<{ translatedText?: string }> } | undefined)
      ?.translations?.[0];
    return requireText(this.name, first?.translatedText);
  }
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

const LOCALE_NAMES_EN: Record<string, string> = {
  de: "German", ja: "Japanese", it: "Italian", ru: "Russian",
  es: "Spanish", fr: "French", uk: "Ukrainian", ar: "Arabic",
};

class OpenAIProvider implements TranslationProvider {
  readonly name = "openai";
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async translate(text: string, targetLocale: string): Promise<string> {
    const language = LOCALE_NAMES_EN[targetLocale] ?? targetLocale;
    const data = await postJson(this.name, "https://api.openai.com/v1/chat/completions", {
      model: this.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            `You are a professional translator. Translate the user's text from English to ${language}. ` +
            "Return ONLY the translated text with no explanations, notes, or quotation marks. " +
            "Preserve line breaks and inline HTML tags exactly.",
        },
        { role: "user", content: text },
      ],
    }, { Authorization: `Bearer ${this.apiKey}` });
    const content = (data.choices as Array<{ message?: { content?: string } }> | undefined)
      ?.[0]?.message?.content;
    return requireText(this.name, content);
  }
}

// ── Factory / configuration ──────────────────────────────────────────────────

type FactoryEntry = { detect: () => boolean; build: () => TranslationProvider };

const FACTORIES: Record<string, FactoryEntry> = {
  libretranslate: {
    detect: () => !!process.env.LIBRE_TRANSLATE_URL,
    build: () => new LibreTranslateProvider(
      (process.env.LIBRE_TRANSLATE_URL as string).replace(/\/$/, ""),
      process.env.LIBRE_TRANSLATE_API_KEY,
    ),
  },
  deepl: {
    detect: () => !!process.env.DEEPL_API_KEY,
    build: () => new DeepLProvider(process.env.DEEPL_API_KEY as string),
  },
  google: {
    detect: () => !!process.env.GOOGLE_TRANSLATE_API_KEY,
    build: () => new GoogleTranslateProvider(process.env.GOOGLE_TRANSLATE_API_KEY as string),
  },
  openai: {
    detect: () => !!process.env.OPENAI_API_KEY,
    build: () => new OpenAIProvider(
      process.env.OPENAI_API_KEY as string,
      process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
    ),
  },
};

// Auto-detection order when TRANSLATION_PROVIDER is not set explicitly.
const PROVIDER_ORDER = ["deepl", "google", "openai", "libretranslate"] as const;

/**
 * Resolve the active provider from configuration, or null when automatic
 * translation is not configured. Resolved fresh on every call so a config
 * change only needs a process restart, never a code change.
 */
export function resolveProvider(): TranslationProvider | null {
  const explicit = process.env.TRANSLATION_PROVIDER?.trim().toLowerCase();
  if (explicit) {
    const entry = FACTORIES[explicit];
    if (!entry || !entry.detect()) return null; // named but missing credentials → treat as unconfigured
    return entry.build();
  }
  for (const name of PROVIDER_ORDER) {
    if (FACTORIES[name].detect()) return FACTORIES[name].build();
  }
  return null;
}
