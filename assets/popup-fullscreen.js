/* ------------------------------------------------------------------
   Con comodo — Popup fullscreen
   Gestisce trigger (ritardo, scroll, exit intent), frequenza di comparsa,
   i tre step (obiettivi → email → conferma) e la memoria della chiusura.
------------------------------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;

class PopupFullscreen extends HTMLElement {
  connectedCallback() {
    this.dialog = this.querySelector('[data-pfs-dialog]');
    if (!this.dialog) return;

    this.designMode = document.documentElement.classList.contains('shopify-design-mode');
    this.emailStep = this.dataset.emailStep === 'true';
    this.storageKey = `concomodo:pfs:${this.dataset.storageKey || this.dataset.sectionId || 'default'}`;
    this.timers = [];
    this.abort = new AbortController();

    const { signal } = this.abort;
    this.addEventListener('click', this.handleClick, { signal });
    this.dialog.addEventListener('close', this.handleClose, { signal });
    this.dialog.addEventListener('cancel', () => this.remember(), { signal });

    const form = this.querySelector('form.pfs__form');
    if (form) form.addEventListener('submit', this.handleSubmit, { signal });

    if (this.designMode) {
      document.addEventListener('shopify:section:select', this.handleSectionSelect, { signal });
      document.addEventListener('shopify:section:deselect', this.handleSectionDeselect, { signal });
      return;
    }

    // Ritorno dall'invio del form: riapriamo direttamente sulla conferma.
    if (this.querySelector('[data-pfs-posted]')) {
      this.restoreGoal();
      this.open('success');
      return;
    }

    if (this.canShow()) this.scheduleTrigger();
  }

  disconnectedCallback() {
    this.abort?.abort();
    for (const timer of this.timers) clearTimeout(timer);
  }

  /* ---------- frequenza ---------- */

  canShow() {
    const frequency = this.dataset.frequency || 'days';
    if (frequency === 'always') return true;

    try {
      if (frequency === 'session') return sessionStorage.getItem(this.storageKey) !== '1';

      const last = Number(localStorage.getItem(this.storageKey) || 0);
      const days = Number(this.dataset.days) || 7;
      return !last || Date.now() - last > days * DAY;
    } catch {
      // Storage non disponibile (private browsing, cookie bloccati): mostriamo comunque.
      return true;
    }
  }

  remember() {
    if (this.designMode) return;
    try {
      sessionStorage.setItem(this.storageKey, '1');
      localStorage.setItem(this.storageKey, String(Date.now()));
    } catch {
      /* niente da fare: il popup ricomparirà al prossimo caricamento */
    }
  }

  /* ---------- trigger ---------- */

  scheduleTrigger() {
    const { signal } = this.abort;
    const delay = (Number(this.dataset.delay) || 0) * 1000;

    switch (this.dataset.trigger) {
      case 'immediate':
        this.open();
        break;

      case 'scroll': {
        const target = Number(this.dataset.scroll) || 30;
        const onScroll = () => {
          const scrollable = document.documentElement.scrollHeight - window.innerHeight;
          const percent = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 100;
          if (percent >= target) {
            window.removeEventListener('scroll', onScroll);
            this.open();
          }
        };
        window.addEventListener('scroll', onScroll, { passive: true, signal });
        onScroll();
        break;
      }

      case 'exit': {
        const onLeave = (/** @type {MouseEvent} */ event) => {
          if (event.clientY <= 0) this.open();
        };
        document.addEventListener('mouseout', onLeave, { signal });
        // Su touch l'exit intent non esiste: fallback a tempo.
        if (delay > 0) this.timers.push(setTimeout(() => this.open(), delay));
        break;
      }

      default:
        this.timers.push(setTimeout(() => this.open(), delay));
    }
  }

  /* ---------- apertura / chiusura ---------- */

  open(step = 'goals') {
    if (this.dialog.open) return;

    this.setStep(step);
    this.dialog.showModal();
    document.body.style.overflow = 'hidden';
    this.remember();

    const focusable = this.dialog.querySelector('[data-pfs-goal], [data-pfs-email], [data-pfs-success-cta]');
    if (focusable instanceof HTMLElement) {
      requestAnimationFrame(() => focusable.focus({ preventScroll: true }));
    }
  }

  close() {
    if (!this.dialog.open) return;
    this.remember();

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.dialog.close();
      return;
    }

    this.dialog.classList.add('pfs--closing');
    this.timers.push(
      setTimeout(() => {
        this.dialog.classList.remove('pfs--closing');
        this.dialog.close();
      }, 220)
    );
  }

  handleClose = () => {
    document.body.style.overflow = '';
  };

  /* ---------- step ---------- */

  setStep(name) {
    for (const step of this.querySelectorAll('[data-pfs-step]')) {
      step.hidden = step.dataset.pfsStep !== name;
    }
  }

  /* ---------- interazioni ---------- */

  handleClick = (/** @type {MouseEvent} */ event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    if (target.closest('[data-pfs-close]')) {
      event.preventDefault();
      this.close();
      return;
    }

    const goal = target.closest('[data-pfs-goal]');
    if (goal instanceof HTMLElement) {
      this.selectGoal(goal, event);
      return;
    }

    const copy = target.closest('[data-pfs-copy]');
    if (copy instanceof HTMLElement) {
      event.preventDefault();
      this.copyCode(copy);
    }
  };

  selectGoal(button, event) {
    const label = button.dataset.label || button.textContent.trim();
    const value = button.dataset.value || handleize(label);
    const link = button.getAttribute('href') || button.dataset.link || '';

    this.goal = { label, value, link };
    this.persistGoal();

    if (!this.emailStep) {
      // Senza step email il bottone-link naviga da solo; se non ha link, chiudiamo.
      if (!link) {
        event.preventDefault();
        this.close();
      }
      return;
    }

    event.preventDefault();

    const tags = this.querySelector('[data-pfs-tags]');
    if (tags instanceof HTMLInputElement) {
      tags.value = `${tags.dataset.base || 'newsletter'}, obiettivo-${value}`;
    }

    for (const chip of this.querySelectorAll('[data-pfs-goal-label]')) {
      chip.textContent = label;
      chip.hidden = false;
    }

    this.setStep('email');
    const email = this.querySelector('[data-pfs-email]');
    if (email instanceof HTMLElement) requestAnimationFrame(() => email.focus({ preventScroll: true }));
  }

  handleSubmit = () => {
    // L'invio ricarica la pagina: conserviamo l'obiettivo per lo step finale.
    this.persistGoal();
  };

  persistGoal() {
    if (!this.goal) return;
    try {
      sessionStorage.setItem(`${this.storageKey}:goal`, JSON.stringify(this.goal));
    } catch {
      /* opzionale */
    }
  }

  restoreGoal() {
    try {
      const raw = sessionStorage.getItem(`${this.storageKey}:goal`);
      if (!raw) return;
      this.goal = JSON.parse(raw);
    } catch {
      return;
    }

    for (const chip of this.querySelectorAll('[data-pfs-goal-label]')) {
      chip.textContent = this.goal.label;
      chip.hidden = false;
    }

    const cta = this.querySelector('[data-pfs-success-cta]');
    if (cta instanceof HTMLAnchorElement && !cta.getAttribute('href') && this.goal.link) {
      cta.href = this.goal.link;
      cta.hidden = false;
    }
  }

  async copyCode(button) {
    const code = button.dataset.pfsCopy;
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = code;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }

    const original = button.dataset.labelDefault || button.textContent.trim();
    button.dataset.labelDefault = original;
    button.textContent = button.dataset.labelCopied || 'Copiato!';
    this.timers.push(
      setTimeout(() => {
        button.textContent = original;
      }, 2000)
    );
  }

  /* ---------- editor tema ---------- */

  handleSectionSelect = (/** @type {CustomEvent} */ event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.contains(this)) return;
    this.open();
  };

  handleSectionDeselect = (/** @type {CustomEvent} */ event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.contains(this)) return;
    this.dialog.close();
  };
}

function handleize(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

if (!customElements.get('popup-fullscreen')) {
  customElements.define('popup-fullscreen', PopupFullscreen);
}
