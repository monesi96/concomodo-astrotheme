/* ------------------------------------------------------------------
   Con comodo — Comparatore materassi con selettori
   Ogni colonna contiene tutti i materassi candidati come "pane" nascosti:
   il cambio di selezione si limita a mostrare quello giusto, quindi il
   confronto è istantaneo e non serve ricaricare la pagina.
------------------------------------------------------------------- */

class MattressCompareSelector extends HTMLElement {
  connectedCallback() {
    this.selects = /** @type {HTMLSelectElement[]} */ ([...this.querySelectorAll('[data-mcs-select]')]);
    if (this.selects.length === 0) return;

    this.previous = new Map();
    this.abort = new AbortController();
    const { signal } = this.abort;

    this.addEventListener('change', this.handleChange, { signal });
    this.addEventListener('click', this.handleClick, { signal });
    document.addEventListener('click', this.handleOutsideClick, { signal });
    document.addEventListener('keydown', this.handleKeydown, { signal });

    this.applyFromUrl();
    this.render(false);
  }

  disconnectedCallback() {
    this.abort?.abort();
  }

  /** Legge ?confronto=handle-1,handle-2 e imposta i selettori. */
  applyFromUrl() {
    const param = this.dataset.param;
    if (!param) return;

    const raw = new URLSearchParams(window.location.search).get(param);
    if (!raw) return;

    const handles = raw.split(',');
    this.selects.forEach((select, index) => {
      const handle = handles[index];
      if (handle == null) return;
      const exists = [...select.options].some((option) => option.value === handle);
      if (exists) select.value = handle;
    });
  }

  handleChange = (/** @type {Event} */ event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const select = target.closest('[data-mcs-select]');
    if (!(select instanceof HTMLSelectElement)) return;

    // Stesso materasso in due colonne: scambiamo invece di duplicarlo.
    if (select.value) {
      const twin = this.selects.find((other) => other !== select && other.value === select.value);
      if (twin) twin.value = this.previous.get(select) ?? '';
    }

    this.render(true);
  };

  render(updateUrl) {
    for (const select of this.selects) {
      const slot = select.dataset.slot;
      const handle = select.value;

      for (const pane of this.querySelectorAll(`[data-mcs-pane][data-slot="${slot}"]`)) {
        pane.hidden = pane.getAttribute('data-handle') !== handle;
      }

      this.previous.set(select, handle);
    }

    if (updateUrl) this.syncUrl();
  }

  syncUrl() {
    const param = this.dataset.param;
    if (!param || !window.history?.replaceState) return;

    const value = this.selects
      .map((select) => select.value)
      .filter(Boolean)
      .join(',');

    const url = new URL(window.location.href);
    if (value) {
      url.searchParams.set(param, value);
    } else {
      url.searchParams.delete(param);
    }

    window.history.replaceState({}, '', url);
  }

  /* ---------- tooltip delle righe ---------- */

  handleClick = (/** @type {MouseEvent} */ event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const button = target.closest('[data-mcs-tip-btn]');
    if (!button) return;

    const tip = button.closest('[data-mcs-tip]');
    if (!(tip instanceof HTMLElement)) return;

    const willOpen = !tip.classList.contains('is-open');
    this.closeTips();
    tip.classList.toggle('is-open', willOpen);
    button.setAttribute('aria-expanded', String(willOpen));
  };

  handleOutsideClick = (/** @type {MouseEvent} */ event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!target.closest('[data-mcs-tip]')) this.closeTips();
  };

  handleKeydown = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape') this.closeTips();
  };

  closeTips() {
    for (const tip of this.querySelectorAll('[data-mcs-tip].is-open')) {
      tip.classList.remove('is-open');
      tip.querySelector('[data-mcs-tip-btn]')?.setAttribute('aria-expanded', 'false');
    }
  }
}

if (!customElements.get('mattress-compare-selector')) {
  customElements.define('mattress-compare-selector', MattressCompareSelector);
}
