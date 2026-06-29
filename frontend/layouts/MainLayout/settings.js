/**
 * VeteransLedger · Settings applier
 * Loads /public/data/site-settings.json and patches the contact modal
 * and cookie banner with CMS-managed text. Called from layout.js after
 * components are injected.
 */

export async function applySettings() {
  let data;
  try {
    const res = await fetch("/public/data/site-settings.json");
    if (res.ok) data = await res.json();
  } catch (_) {}
  if (!data) return;

  applyContactModal(data.contact);
  applyCookieBanner(data.cookieBanner);
}

function setText(id, value) {
  if (!value) return;
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function applyContactModal(contact) {
  if (!contact) return;

  setText("contact-modal-title",     contact.modalTitle);
  setText("contact-info-heading",    contact.infoHeading);
  setText("contact-info-text",       contact.infoText);
  setText("contact-email-label",     contact.emailLabel);
  setText("contact-message-guidance", contact.guidanceText);

  const emailLink = document.getElementById("contact-email-addr");
  if (emailLink && contact.email) {
    emailLink.textContent = contact.email;
    emailLink.href = `mailto:${contact.email}`;
  }

  const toInput = document.getElementById("contact-to");
  if (toInput && contact.toDisplay) {
    toInput.value = contact.toDisplay;
  }
}

function applyCookieBanner(cookie) {
  if (!cookie) return;

  // Replace the text node before the privacy link, preserving the <a> element
  const textEl = document.getElementById("cookie-banner-text");
  if (textEl && cookie.text) {
    const link = document.getElementById("cookie-privacy-link");
    textEl.textContent = cookie.text + " ";
    if (link) {
      if (cookie.privacyLabel) link.textContent = cookie.privacyLabel;
      if (cookie.privacyHref)  link.href = cookie.privacyHref;
      textEl.appendChild(link);
    }
  }

  setText("cookie-accept-btn",  cookie.acceptLabel);
  setText("cookie-dismiss-btn", cookie.dismissLabel);
}
