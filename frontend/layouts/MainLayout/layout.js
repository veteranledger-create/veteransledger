/**
 * VeteransLedger · Layout bootstrap
 * Fetches shared components and injects them, then hydrates navigation.
 * Usage: <script type="module" src="/layouts/MainLayout/layout.js"></script>
 */
import { initNavigation } from "/layouts/MainLayout/navigation.js";
import { applySettings } from "/layouts/MainLayout/settings.js";
import "/layouts/MainLayout/page-content.js";

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
  applySettings(); // fire-and-forget: patches contact modal + cookie banner text
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
  const modal         = document.getElementById("contact-modal");
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = "1";

  const closeBtn      = document.getElementById("contact-modal-close");
  const confCloseBtn  = document.getElementById("contact-confirmed-close");
  const form          = document.getElementById("contact-form");
  const nameInput     = document.getElementById("contact-name");
  const emailInput    = document.getElementById("contact-email");
  const subjectInput  = document.getElementById("contact-subject");
  const msgInput      = document.getElementById("contact-message");
  const counterEl     = document.getElementById("contact-counter-display");
  const status        = document.getElementById("contact-status");
  const submitBtn     = form?.querySelector("[type='submit']");
  const panel         = modal.querySelector(".pc__panel");
  const procMsgEl     = document.getElementById("contact-processing-msg");
  const confRefEl     = document.getElementById("contact-ref-id");

  const MIN_SUBJECT = 15;
  const MIN_MESSAGE = 500;
  const MAX_MESSAGE = 5000;

  const PROC_MSGS = [
    "Sealing archival document...",
    "Authenticating submission...",
    "Transferring to the VeteransLedger Archive Office...",
    "Security verification completed.",
    "Archive reference successfully registered.",
  ];

  function resetModalState() {
    if (panel) panel.classList.remove("is-processing", "is-confirmed");
    if (procMsgEl) procMsgEl.textContent = PROC_MSGS[0];
    if (status) { status.className = "contact-form__status"; status.textContent = ""; }
  }

  const close = () => {
    modal.hidden = true;
    resetModalState();
  };

  if (closeBtn)     closeBtn.addEventListener("click", close);
  if (confCloseBtn) confCloseBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => {
    if (!modal.hidden && e.key === "Escape") close();
  });

  function updateState() {
    const msgLen     = msgInput?.value.length ?? 0;
    const subjectLen = subjectInput?.value.trim().length ?? 0;
    const nameFilled = (nameInput?.value.trim().length ?? 0) >= 1;
    const emailFilled = (emailInput?.value.trim() ?? "").includes("@");
    const ready      = msgLen >= MIN_MESSAGE && subjectLen >= MIN_SUBJECT && nameFilled && emailFilled;

    if (counterEl) {
      if (msgLen >= MIN_MESSAGE) {
        counterEl.innerHTML =
          `<span id="contact-char-count" style="color:#70b070;font-weight:600">${msgLen}</span> / ${MAX_MESSAGE} ✓`;
      } else {
        counterEl.innerHTML =
          `<span id="contact-char-count" style="font-weight:600">${msgLen}</span> / ${MIN_MESSAGE} minimum characters`;
      }
    }

    if (submitBtn) submitBtn.disabled = !ready;
  }

  if (nameInput)    nameInput.addEventListener("input", updateState);
  if (emailInput)   emailInput.addEventListener("input", updateState);
  if (subjectInput) subjectInput.addEventListener("input", updateState);
  if (msgInput)     msgInput.addEventListener("input", updateState);

  function showStatus(msg, type) {
    if (!status) return;
    status.textContent = msg;
    status.className   = `contact-form__status is-${type}`;
  }

  function genRef() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const t  = String(d.getHours()).padStart(2, "0")
             + String(d.getMinutes()).padStart(2, "0")
             + String(d.getSeconds()).padStart(2, "0");
    return `VL-${y}-${m}-${dd}-${t}`;
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (status) { status.className = "contact-form__status"; status.textContent = ""; }

      const name    = nameInput?.value.trim()    ?? "";
      const email   = emailInput?.value.trim()   ?? "";
      const subject = subjectInput?.value.trim() ?? "";
      const message = msgInput?.value.trim()     ?? "";

      if (!name) {
        showStatus("Please enter your name.", "error");
        nameInput?.focus();
        return;
      }
      if (!email.includes("@")) {
        showStatus("Please enter a valid email address.", "error");
        emailInput?.focus();
        return;
      }
      if (subject.length < MIN_SUBJECT) {
        showStatus(`Subject must be at least ${MIN_SUBJECT} characters.`, "error");
        subjectInput?.focus();
        return;
      }
      if (message.length < MIN_MESSAGE) {
        showStatus(`Message must be at least ${MIN_MESSAGE} characters.`, "error");
        msgInput?.focus();
        return;
      }

      if (submitBtn) submitBtn.disabled = true;

      // Enter processing state — seal stamp animation starts
      if (panel) panel.classList.add("is-processing");

      // Cycle archival status messages
      let msgIdx = 0;
      const advanceMsg = () => {
        if (procMsgEl && msgIdx < PROC_MSGS.length - 1) {
          msgIdx++;
          procMsgEl.textContent = PROC_MSGS[msgIdx];
        }
      };
      const t1 = setTimeout(advanceMsg, 700);
      const t2 = setTimeout(advanceMsg, 1450);
      const t3 = setTimeout(advanceMsg, 2150);

      try {
        // Run API call concurrently with minimum 2.8s animation floor
        const minDelay = new Promise((r) => setTimeout(r, 2800));
        const [result] = await Promise.all([
          fetch("/api/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, subject, message }),
          }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) })),
          minDelay,
        ]);

        clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);

        if (!result.ok) throw new Error(result.data?.error || "Send failed");

        // Show final message, brief pause, then transition to confirmed
        if (procMsgEl) procMsgEl.textContent = PROC_MSGS[PROC_MSGS.length - 1];
        await new Promise((r) => setTimeout(r, 500));

        if (confRefEl) confRefEl.textContent = genRef();
        if (panel) {
          panel.classList.remove("is-processing");
          panel.classList.add("is-confirmed");
        }
        form.reset();
        updateState();
      } catch (err) {
        clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
        resetModalState();
        showStatus(err.message || "Failed to send. Please email us directly.", "error");
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Delegated trigger — works for any [data-action='open-contact'] on any page
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-action='open-contact']");
    if (!trigger) return;
    e.preventDefault();
    resetModalState();
    modal.hidden = false;
    const firstInput = modal.querySelector("input:not([type='hidden']), textarea");
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
