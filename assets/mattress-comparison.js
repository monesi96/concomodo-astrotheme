import { Component } from '@theme/component';

/**
 * Two-mattress comparison section.
 *
 * Column A is the product on the page; column B is picked by the shopper from
 * the mattresses of its collection. Every candidate is pre-rendered as a hidden
 * pane by Liquid, so switching is a visibility toggle — no fetch, no reflow of
 * the rest of the page.
 *
 * The other behaviour here is the "?" tooltips: clicking a tooltip button
 * toggles its bubble, closes any other open one, and closes on outside click
 * or Escape.
 *
 * @extends {Component}
 */
export class MattressComparisonComponent extends Component {
  /** @type {AbortController | null} */
  #abort = null;

  connectedCallback() {
    super.connectedCallback();
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    document.addEventListener('click', this.#handleOutsideClick, { signal });
    document.addEventListener('keydown', this.#handleKeydown, { signal });

    // Al ritorno indietro il browser ripristina il valore del select: riallineiamo.
    this.#showSelected();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
  }

  /**
   * Show the picked mattress. Bound via `on:change="/handleSelect"` on the select.
   */
  handleSelect() {
    this.#showSelected();
  }

  #showSelected() {
    const picker = this.refs.picker;
    if (!(picker instanceof HTMLSelectElement)) return;

    const handle = picker.value;
    let url = '';

    for (const pane of this.querySelectorAll('[data-pane]')) {
      if (!(pane instanceof HTMLElement)) continue;
      const isSelected = pane.dataset.handle === handle;
      pane.hidden = !isSelected;
      if (isSelected && pane.dataset.url) url = pane.dataset.url;
    }

    // La CTA senza link fisso punta al materasso mostrato in quel momento.
    const cta = this.refs.cta;
    if (cta instanceof HTMLAnchorElement && url) cta.href = url;
  }

  /**
   * Toggle a tooltip bubble. Bound via `on:click="/toggleTip"` on the button.
   * @param {MouseEvent} event
   */
  toggleTip(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const tip = target.closest('[data-tip]');
    if (!(tip instanceof HTMLElement)) return;

    const willOpen = !tip.classList.contains('is-open');
    this.#closeAll();
    tip.classList.toggle('is-open', willOpen);
    tip.querySelector('[data-tip-btn]')?.setAttribute('aria-expanded', String(willOpen));
  }

  #closeAll() {
    for (const tip of this.querySelectorAll('[data-tip].is-open')) {
      tip.classList.remove('is-open');
      tip.querySelector('[data-tip-btn]')?.setAttribute('aria-expanded', 'false');
    }
  }

  #handleOutsideClick = (/** @type {MouseEvent} */ event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!target.closest('[data-tip]')) this.#closeAll();
  };

  #handleKeydown = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape') this.#closeAll();
  };
}

customElements.define('mattress-comparison-component', MattressComparisonComponent);
