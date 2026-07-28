/* ------------------------------------------------------------------
   Con comodo — Slider testuale
   Strip a scorrimento continuo: duplica il gruppo di voci finché non
   copre almeno due volte la viewport, poi anima la traccia di esattamente
   una larghezza-gruppo (loop invisibile). La durata deriva dalla velocità
   in px/s impostata nella sezione, così lo scorrimento resta costante
   qualunque sia il numero di voci.
------------------------------------------------------------------- */

class TextSliderStrip extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector('[data-ts-track]');
    this.group = this.querySelector('[data-ts-group]');
    if (!this.track || !this.group) return;

    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.onResize = debounce(() => this.layout(), 150);

    this.observer = new ResizeObserver(this.onResize);
    this.observer.observe(this);

    this.reduced.addEventListener('change', this.onResize);

    this.layout();

    // I font web cambiano la larghezza del gruppo: rimisura appena pronti.
    if (document.fonts?.ready) document.fonts.ready.then(() => this.layout());
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.reduced?.removeEventListener('change', this.onResize);
  }

  /** Rimuove i cloni, rimisura e ne crea quanti ne servono. */
  layout() {
    if (!this.isConnected) return;

    for (const clone of this.querySelectorAll('[data-ts-clone]')) clone.remove();

    const groupWidth = this.group.getBoundingClientRect().width;
    if (groupWidth === 0) return;

    if (this.reduced.matches) {
      this.classList.remove('text-slider--ready');
      return;
    }

    const needed = Math.max(1, Math.ceil((this.offsetWidth * 2) / groupWidth));
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < needed; i++) {
      const clone = /** @type {HTMLElement} */ (this.group.cloneNode(true));
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('data-ts-clone', '');
      clone.removeAttribute('data-ts-group');
      // I cloni non devono entrare nell'ordine di tabulazione.
      for (const link of clone.querySelectorAll('a')) link.setAttribute('tabindex', '-1');
      fragment.appendChild(clone);
    }

    this.track.appendChild(fragment);

    const speed = Math.max(5, Number(this.dataset.speed) || 60);
    this.style.setProperty('--ts-distance', `${groupWidth}px`);
    this.style.setProperty('--ts-duration', `${groupWidth / speed}s`);
    this.classList.add('text-slider--ready');
  }
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

if (!customElements.get('text-slider-strip')) {
  customElements.define('text-slider-strip', TextSliderStrip);
}
