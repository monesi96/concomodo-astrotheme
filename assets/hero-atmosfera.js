/* ------------------------------------------------------------------
   Con comodo — Hero atmosfera (v2)
   Unico compito: aggiornare --ha-p (0 in cima, 1 quando l'hero è
   uscito dallo schermo). Tutto il resto è CSS. Aggiorna solo mentre
   l'hero è visibile e rispetta prefers-reduced-motion.
------------------------------------------------------------------- */

class HeroAtmosfera extends HTMLElement {
  connectedCallback() {
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (this.reduced.matches) return;

    this.ticking = false;
    this.visible = true;

    this.observer = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.request();
    });
    this.observer.observe(this);

    window.addEventListener('scroll', this.request, { passive: true });
    window.addEventListener('resize', this.request, { passive: true });
    this.request();
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    window.removeEventListener('scroll', this.request);
    window.removeEventListener('resize', this.request);
  }

  request = () => {
    if (this.ticking || !this.visible) return;
    this.ticking = true;
    requestAnimationFrame(this.update);
  };

  update = () => {
    this.ticking = false;

    const { top, height } = this.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, -top / Math.max(1, height)));
    this.style.setProperty('--ha-p', progress.toFixed(4));
  };
}

if (!customElements.get('hero-atmosfera')) {
  customElements.define('hero-atmosfera', HeroAtmosfera);
}
