/**
 * VeteransLedger · Layout bootstrap
 * Fetches shared components and injects them, then hydrates navigation.
 * Usage: <script type="module" src="/layouts/MainLayout/layout.js"></script>
 */
import { initNavigation } from "/layouts/MainLayout/navigation.js";

const DEFAULTS = {
  components: {
    header: "/components/Header/header.html",
    sidebar: "/components/Sidebar/sidebar.html",
    mobileMenu: "/components/Sidebar/mobile-menu.html",
    footer: "/components/Footer/footer.html",
    cookieBanner: "/components/CookieBanner/cookie-banner.html",
    contactModal: "/components/ContactModal/contact-modal.html",
  },
};

function resolveConfig() {
  const override =
    (typeof window !== "undefined" && window.VL_NAV_CONFIG) || {};
  return {
    components: { ...DEFAULTS.components, ...(override.components || {}) },
  };
}

async function fetchComponent(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Component ${url} → HTTP ${res.status}`);
  return res.text();
}

let injected = false;

export async function injectLayout() {
  if (injected || document.documentElement.hasAttribute("data-layout-ready"))
    return;
  injected = true;

  const cfg = resolveConfig();
  let parts;
  try {
    const [header, sidebar, mobileMenu, footer, cookieBanner, contactModal] =
      await Promise.all([
        fetchComponent(cfg.components.header),
        fetchComponent(cfg.components.sidebar),
        fetchComponent(cfg.components.mobileMenu),
        fetchComponent(cfg.components.footer),
        fetchComponent(cfg.components.cookieBanner),
        fetchComponent(cfg.components.contactModal),
      ]);
    parts = { header, sidebar, mobileMenu, footer, cookieBanner, contactModal };
  } catch (err) {
    console.error("[layout] Failed to load components:", err);
    injected = false;
    return;
  }

  document.body.insertAdjacentHTML(
    "afterbegin",
    parts.header + parts.sidebar + parts.mobileMenu,
  );
  document.body.insertAdjacentHTML(
    "beforeend",
    parts.footer + parts.cookieBanner + parts.contactModal,
  );
  document.body.classList.add("has-app-shell");

  const main = document.querySelector("main");
  if (main && !main.id) main.id = "main-content";

  document.documentElement.setAttribute("data-layout-ready", "");

  await initNavigation();
  initCookieBanner();
  initContactModal();
}

function initCookieBanner() {
  const banner = document.getElementById("cookie-banner");
  if (!banner) return;
  try {
    if (localStorage.getItem("cookie-consent")) {
      banner.hidden = true;
      return;
    }
  } catch (_) {}

  banner.hidden = false;

  const acceptBtn = banner.querySelector("[data-cookie-action='accept']");
  const dismissBtn = banner.querySelector("[data-cookie-action='dismiss']");

  const dismiss = () => {
    banner.hidden = true;
    try {
      localStorage.setItem("cookie-consent", "1");
    } catch (_) {}
  };

  if (acceptBtn) acceptBtn.addEventListener("click", dismiss);
  if (dismissBtn) dismissBtn.addEventListener("click", dismiss);
}

function initContactModal() {
  const modal = document.getElementById("contact-modal");
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = "1";

  const closeBtn = document.getElementById("contact-modal-close");
  const form = document.getElementById("contact-form");
  const msgInput = document.getElementById("contact-message");
  const charCount = document.getElementById("contact-char-count");
  const status = document.getElementById("contact-status");

  const close = () => {
    modal.hidden = true;
  };

  if (closeBtn) closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener("keydown", (e) => {
    if (!modal.hidden && e.key === "Escape") close();
  });

  if (msgInput && charCount) {
    msgInput.addEventListener("input", () => {
      charCount.textContent = msgInput.value.length;
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (status) {
        status.className = "contact-form__status";
        status.textContent = "";
      }

      const subject = document.getElementById("contact-subject")?.value.trim();
      const message = msgInput?.value.trim();

      if (!subject) {
        showStatus("Please enter a subject.", "error");
        return;
      }
      if (!message || message.length < 20) {
        showStatus("Message must be at least 20 characters.", "error");
        return;
      }

      const submitBtn = form.querySelector("[type='submit']");
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, message }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Send failed");
        showStatus(
          "Message sent successfully. We'll respond within 14 days.",
          "success",
        );
        form.reset();
        if (charCount) charCount.textContent = "0";
      } catch (err) {
        showStatus(
          err.message || "Failed to send. Please email us directly.",
          "error",
        );
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  function showStatus(msg, type) {
    if (!status) return;
    status.textContent = msg;
    status.className = `contact-form__status is-${type}`;
  }

  // Delegated trigger — works for any [data-action='open-contact'] on any page
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-action='open-contact']");
    if (!trigger) return;
    e.preventDefault();
    modal.hidden = false;
    const firstInput = modal.querySelector("input:not([readonly]), textarea");
    if (firstInput) firstInput.focus();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        injectLayout();
      },
      { once: true },
    );
  } else {
    injectLayout();
  }
}
