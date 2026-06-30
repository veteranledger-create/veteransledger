/**
 * VeteransLedger · Site Policies page
 * Loads policy JSON files and renders content sections.
 * Policy list loaded from site-policies/index.json — no hardcoded arrays.
 * Also highlights the TOC link as user scrolls.
 */

import { loadTranslation, machineNoticeHtml } from "/pages/shared/translation-loader.js";
import { onLocaleChange } from "/pages/shared/i18n.js";

let POLICIES = [];

async function loadManifest() {
  try {
    const res = await fetch("/public/data/site-policies/index.json");
    const data = res.ok ? await res.json() : null;
    POLICIES = data?.policies ?? [];
  } catch (_) {}
  if (!POLICIES.length) {
    POLICIES = [
      { id: "terms",      file: "/public/data/site-policies/terms-of-use.json",    bodyId: "terms-body" },
      { id: "privacy",    file: "/public/data/site-policies/privacy-policy.json",  bodyId: "privacy-body" },
      { id: "disclaimer", file: "/public/data/site-policies/disclaimer.json",      bodyId: "disclaimer-body" },
      { id: "copyright",  file: "/public/data/site-policies/copyright-policy.json","bodyId": "copyright-body" },
    ];
  }
}

async function init() {
  await loadManifest();
  await Promise.allSettled(POLICIES.map(loadPolicy));
  initScrollSpy();
  initContactTrigger();

  onLocaleChange(() => Promise.allSettled(POLICIES.map(loadPolicy)));
}

async function loadPolicy({ id, file, bodyId }) {
  const container = document.getElementById(bodyId);
  if (!container) return;

  let data = null;
  try {
    const res = await fetch(file);
    data = res.ok ? await res.json() : null;
  } catch (_) {
    data = null;
  }

  // site_content translations store the whole source file as one
  // re-translated JSON string — swap it in transparently before rendering.
  let isMachine = false;
  if (data) {
    const entityId = file.replace("/public/data/", "");
    const t = await loadTranslation("site_content", entityId);
    if (t?.fields?.content) {
      try { data = JSON.parse(t.fields.content); isMachine = t.isMachine; }
      catch { /* translated content isn't valid JSON — keep English */ }
    }
  }

  renderPolicy(container, id, data);
  container.querySelector(".vl-mt-notice")?.remove();
  if (isMachine) container.insertAdjacentHTML("afterbegin", machineNoticeHtml({ isMachine: true }));
}

function renderPolicy(container, id, data) {
  if (!data) {
    container.innerHTML = defaultPolicy(id);
    return;
  }

  const content = data.content || data.text || data.body || "";
  if (typeof content === "string") {
    container.innerHTML = `<p>${content.replace(/\n\n/g, "</p><p>")}</p>`;
  } else if (Array.isArray(content)) {
    container.innerHTML = content
      .map((section) => {
        if (section.list && Array.isArray(section.list)) {
          return `<ul>${section.list.map((item) => `<li>${item}</li>`).join("")}</ul>`;
        }
        return `${section.heading ? `<h3>${section.heading}</h3>` : ""}<p>${section.text || section.body || ""}</p>`;
      })
      .join("");
  } else {
    container.innerHTML = defaultPolicy(id);
  }
}

function defaultPolicy(id) {
  const defaults = {
    terms: `<p>By accessing VeteransLedger, you agree to use this archive solely for educational, research, and historical purposes. You may not reproduce, redistribute, or repurpose content without attribution. The archive reserves the right to modify or remove content at any time.</p>
      <p>This archive is not affiliated with any political organisation. Content is provided for informational purposes only.</p>`,
    privacy: `<p>VeteransLedger collects no personal data beyond session cookies required for site functionality (theme preference, navigation state). No analytics, tracking scripts, or third-party data processors are used.</p>
      <p>We use localStorage only to remember your theme and cookie consent preference. No data is transmitted to third parties.</p>`,
    disclaimer: `<p>VeteransLedger is a personal historical archive maintained strictly for educational purposes. All content documents the 1933–1945 period objectively. This archive neither promotes nor endorses the ideologies, regimes, or actions documented herein.</p>
      <p>Historical accuracy is prioritised. Where errors are identified, corrections are welcomed via the contact form.</p>`,
    copyright: `<p>Historical documents, photographs, and records in the public domain are reproduced for educational purposes under fair use provisions. Where copyright is held by third parties, material is cited accordingly.</p>
      <p>Original editorial content, translations, and annotations are © VeteransLedger. Contact us for reproduction permissions.</p>`,
    removal: `<p>If you are the subject of, or hold rights to, any content on this archive and wish to request its removal, please contact us directly.</p>
      <p>All removal requests are reviewed within 14 days. Please include:</p>
      <ul>
        <li>Your full name and relationship to the content</li>
        <li>A specific description of the content to be removed</li>
        <li>The URL or page where it appears</li>
        <li>The legal or personal basis for the removal request</li>
      </ul>`,
  };
  return defaults[id] || "<p>Policy content is being prepared.</p>";
}

function initScrollSpy() {
  const tocLinks = document.querySelectorAll(".policies-toc__link");
  const sections = document.querySelectorAll(".policy-section");

  if (!tocLinks.length || !sections.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          tocLinks.forEach((link) => {
            link.classList.toggle(
              "is-active",
              link.getAttribute("href") === `#${entry.target.id}`,
            );
          });
        }
      });
    },
    { rootMargin: "-20% 0px -60% 0px" },
  );

  sections.forEach((sec) => observer.observe(sec));
}

function initContactTrigger() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-action='open-contact']")) {
      // Delegate to home.js contact modal wiring
      const modal = document.getElementById("contact-modal");
      if (modal) {
        modal.hidden = false;
        modal.querySelector("input:not([readonly])")?.focus();
      }
    }
  });
}

init();
