/**
 * VeteransLedger · Shared Pagination Utility
 * ES module — import with: import { createPaginator } from '/pages/shared/paginator.js';
 */

/**
 * @param {object} opts
 * @param {Array}       opts.items        Full item array to paginate
 * @param {number}      opts.pageSize     Items per page
 * @param {Function}    opts.renderFn     Called with (pageSlice) to render items
 * @param {HTMLElement} opts.pagerEl      Container element for pagination controls
 * @param {HTMLElement} [opts.scrollTarget] Element to scroll to on page change
 * @returns {{ setItems(arr): void, reset(): void }}
 */
export function createPaginator({ items, pageSize, renderFn, pagerEl, scrollTarget }) {
  let _items = items;
  let _page  = 1;

  function totalPages() {
    return Math.max(1, Math.ceil(_items.length / pageSize));
  }

  function render() {
    const tp    = totalPages();
    const start = (_page - 1) * pageSize;
    renderFn(_items.slice(start, start + pageSize));
    _renderControls(tp);
  }

  function goTo(p) {
    _page = Math.max(1, Math.min(p, totalPages()));
    render();
    if (scrollTarget) {
      scrollTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function setItems(newItems) {
    _items = newItems;
    _page  = 1;
    render();
  }

  function reset() {
    _page = 1;
    render();
  }

  function _renderControls(tp) {
    if (!pagerEl) return;
    if (tp <= 1) { pagerEl.innerHTML = ""; return; }

    const nums = _pageNums(_page, tp);
    pagerEl.innerHTML = `
      <button class="pagination__btn" data-p="${_page - 1}"
        ${_page <= 1 ? "disabled" : ""} aria-label="Previous page">‹ Prev</button>
      ${nums.map(n =>
        n === "…"
          ? `<span class="pagination__ellipsis">…</span>`
          : `<button class="pagination__btn${n === _page ? " is-active" : ""}"
               data-p="${n}" aria-label="Page ${n}">${n}</button>`
      ).join("")}
      <button class="pagination__btn" data-p="${_page + 1}"
        ${_page >= tp ? "disabled" : ""} aria-label="Next page">Next ›</button>`;

    pagerEl.querySelectorAll("[data-p]").forEach(btn => {
      btn.addEventListener("click", () => goTo(parseInt(btn.dataset.p, 10)));
    });
  }

  function _pageNums(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const set = new Set([1, total, current,
      current - 1, current + 1, current - 2, current + 2].filter(n => n >= 1 && n <= total));
    const sorted = [...set].sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("…");
      result.push(sorted[i]);
    }
    return result;
  }

  render();
  return { setItems, reset };
}
