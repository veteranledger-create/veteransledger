/**
 * SITE CONFIGURATION
 * VeteranLedger – Axis History Archive 1933-1945
 *
 * Central configuration for the entire archival platform.
 * All site-wide settings, paths, and metadata are defined here.
 * No hardcoded strings should exist in page modules.
 */

export const SITE = {
  name: "VeteranLedger",
  tagline: "Axis History Archive 1933–1945",
  url: "https://veteransledger.com",
  description:
    "Historical letters, battles, veterans stories and military technology from the Axis powers of World War II.",
  language: "en",
  locale: "en_US",

  /** Contact and legal */
  email: "veteranledger@gmail.com",
  copyright: "Personal Research Archive · Educational Purposes Only",

  /** Google AdSense */
  adsense: {
    client: "ca-pub-4660758104899478",
    src: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
  },

  /** Google Analytics */
  analytics: {
    id: "AW-18147274954",
    conversionLabel: "WTUnCM24rqkcEMrhpc1D",
  },

  /** SEO defaults */
  seo: {
    defaultImage: "/images/ui/logo-web-site.png",
    twitterHandle: null,
    facebookAppId: null,
  },
};

/**
 * Navigation structure for the entire site.
 * Each route maps to an existing HTML page.
 */
export const NAVIGATION = [
  { label: "Home", path: "/", title: "VeteranLedger – Axis History Archive" },
  {
    label: "Veterans",
    path: "/veterans.html",
    title: "Veterans Archive – German Military Commanders",
  },
  {
    label: "Battles",
    path: "/battles.html",
    title: "Battles Archive – Major Engagements",
  },
  {
    label: "Technology",
    path: "/technology.html",
    title: "Technology Archive – Weapons & Equipment",
  },
  {
    label: "Articles",
    path: "/articles.html",
    title: "Articles – Historical Analysis",
  },
  {
    label: "Letters",
    path: "/letters.html",
    title: "Letters – Historical Correspondence",
  },
  {
    label: "Political",
    path: "/political.html",
    title: "Political Archive – Leadership & Regimes",
  },
  {
    label: "Timeline",
    path: "/timeline.html",
    title: "Timeline – WWII Chronology",
  },
];

/**
 * Legal and footer links
 */
export const LEGAL_LINKS = [
  { label: "Disclaimer", path: "/disclaimer.html" },
  { label: "Image Credits", path: "/credits.html" },
];

/**
 * Theme configuration
 */
export const THEME = {
  storageKey: "theme",
  defaultTheme: "light",
  darkTheme: "dark",
};

/**
 * Data sources configuration
 */
export const DATA_SOURCES = {
  veterans: {
    jsonPath: "/data/veterans.json",
    jsPath: "/data/veterans.js",
    variableName: "veteranProfiles",
  },
  battles: {
    jsonPath: "/data/battles.json",
    jsPath: "/data/battles.js",
    variableName: "battlesData",
  },
  technology: {
    jsonPath: "/data/technology.json",
    jsPath: "/data/technology.js",
    variableName: "technologyData",
  },
  topics: {
    jsonPath: "/data/topics.json",
    jsPath: "/data/topics.js",
    variableName: "topicsData",
  },
  letters: {
    jsonPath: "/data/letters.json",
    jsPath: "/data/letters.js",
    variableName: "lettersData",
  },
  modal: {
    jsonPath: "/data/modal.json",
    jsPath: "/data/modal.js",
    variableName: "modalData",
  },
};
