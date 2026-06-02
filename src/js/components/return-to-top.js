/**
 * RETURN TO TOP COMPONENT
 * Floating button that appears when scrolled down.
 *
 * Usage:
 *   import { initReturnToTop } from '@components/return-to-top';
 *   initReturnToTop();
 */

/**
 * Initialize the return-to-top button.
 */
export function initReturnToTop() {
  let btn = document.getElementById('return-top');

  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'return-top';
    btn.textContent = '↑ TOP';
    btn.setAttribute('aria-label', 'Return to top of page');
    document.body.appendChild(btn);
  }

  const handleScroll = () => {
    if (window.scrollY > 300) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  };

  // Throttled scroll listener
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        handleScroll();
        ticking = false;
      });
      ticking = true;
    }
  });

  btn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  });

  // Initial check
  handleScroll();
}
