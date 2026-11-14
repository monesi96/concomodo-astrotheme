import { Component } from '@theme/component';
import { prefersReducedMotion } from '@theme/utilities';

/**
 * @typedef {Object} MattressLayersRefs
 * @property {HTMLElement} stage - The wrapper holding the stacked layer images.
 * @property {HTMLElement[]} [layers] - The individual layer image elements.
 * @property {HTMLElement[]} [captions] - The caption buttons (title + description).
 * @property {HTMLButtonElement} [toggle] - The open / close button.
 */

/**
 * Interactive "exploded view" of a mattress.
 *
 * With "data-start-closed" the mattress stays closed (cover + base, titles only)
 * until the visitor clicks the mattress, a caption or the toggle button.
 * Clicking the mattress only explodes it; clicking a caption explodes it and
 * highlights that layer. The toggle button closes it again.
 *
 * With "data-open" in the markup (toppers) it starts exploded.
 *
 * Without either attribute it keeps the original behaviour: closed, then it
 * explodes once the section scrolls into view.
 *
 * @extends {Component<MattressLayersRefs>}
 */
export class MattressLayersComponent extends Component {
  requiredRefs = ['stage'];

  /** @type {number | null} */
  #active = null;
  /** @type {IntersectionObserver | null} */
  #io = null;
  /** @type {AbortController | null} */
  #abort = null;
  /** @type {number} */
  #openTimer = 0;

  connectedCallback() {
    super.connectedCallback();

    this.#abort = new AbortController();
    const { signal } = this.#abort;

    // Reset when clicking anywhere outside the component or pressing Escape.
    document.addEventListener('click', this.#handleOutsideClick, { signal });
    document.addEventListener('keydown', this.#handleKeydown, { signal });

    this.#syncToggle();

    // Already open from the markup (toppers) or waiting for a click.
    if (this.hasAttribute('data-open') || this.hasAttribute('data-start-closed')) return;

    if (prefersReducedMotion() || this.hasAttribute('data-no-animation')) {
      this.#open();
      return;
    }

    // Reveal (explode) the layers once the section scrolls into view.
    this.#io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.#io?.disconnect();
          this.#io = null;
          // Show the closed mattress briefly, then explode.
          this.#openTimer = window.setTimeout(() => this.#open(), 450);
        }
      },
      { threshold: 0.35 }
    );

    this.#io.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#io?.disconnect();
    this.#io = null;
    window.clearTimeout(this.#openTimer);
  }

  get #isOpen() {
    return this.hasAttribute('data-open');
  }

  #open() {
    this.setAttribute('data-open', '');
    this.#syncToggle();
  }

  #close() {
    this.#setActive(null);
    this.removeAttribute('data-open');
    this.#syncToggle();
  }

  #syncToggle() {
    this.refs.toggle?.setAttribute('aria-expanded', String(this.#isOpen));
  }

  /**
   * Open / close the exploded view. Bound declaratively via "on:click="/toggle"".
   */
  toggle() {
    if (this.#isOpen) this.#close();
    else this.#open();
  }

  /**
   * Toggle the active layer/caption. Bound declaratively via "on:click="/select"".
   * The clicked element (caption or layer) must carry a "data-index" attribute.
   *
   * @param {MouseEvent} event
   */
  select(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const item = target.closest('[data-index]');
    if (!(item instanceof HTMLElement)) return;

    if (!this.#isOpen) {
      this.#open();
      // A click on the closed mattress only explodes it; a click on a caption
      // also highlights that layer.
      if (!item.classList.contains('mattress-layers__caption')) return;
    }

    const index = Number(item.dataset.index);
    if (Number.isNaN(index)) return;

    this.#setActive(this.#active === index ? null : index);
  }

  /**
   * @param {number | null} index
   */
  #setActive(index) {
    this.#active = index;

    if (index === null) {
      this.removeAttribute('data-active');
    } else {
      this.setAttribute('data-active', String(index));
    }

    for (const el of [...(this.refs.layers ?? []), ...(this.refs.captions ?? [])]) {
      const isActive = index !== null && Number(el.dataset.index) === index;
      el.classList.toggle('is-active', isActive);
      if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(isActive));
    }
  }

  #handleOutsideClick = (/** @type {MouseEvent} */ event) => {
    if (this.#active === null) return;
    const target = /** @type {Node} */ (event.target);
    if (!this.contains(target)) this.#setActive(null);
  };

  #handleKeydown = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape' && this.#active !== null) this.#setActive(null);
  };
}

customElements.define('mattress-layers-component', MattressLayersComponent);
