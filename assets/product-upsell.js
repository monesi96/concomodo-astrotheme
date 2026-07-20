import { ThemeEvents, CartUpdateEvent } from '@theme/events';
import { fetchConfig } from '@theme/utilities';

/**
 * <product-upsell>
 *
 * Product-page upsell with a guided choice:
 *
 * - Two toppers in mutually exclusive choice: adding one removes the other
 *   from the cart. Each topper inherits the Dimensione/Misure selected on the
 *   main product (same matching rules as <linked-size-add>).
 * - A gift pillow that is auto-added when a topper is chosen (flagged with a
 *   hidden `_in_regalo` line item property so it can be told apart from a solo
 *   purchase), or added alone at a display discount.
 *
 * The component only renders the promo prices. The actual cart prices must be
 * backed by automatic discounts configured in the Shopify admin.
 */

const GIFT_FLAG = '_in_regalo';
const GIFT_PROPERTY_LABEL = 'Omaggio';

/**
 * Reads the Dimensione/Misure currently selected on the page's main variant picker.
 * Returns null when the page has no picker exposing those options.
 *
 * @returns {{dimensione?: string, misure?: string} | null}
 */
function readMainSelection() {
  for (const picker of document.querySelectorAll('variant-picker')) {
    // Ignore pickers rendered inside quick-add modals.
    if (picker.closest('dialog')) continue;

    const selection = {};

    for (const fieldset of picker.querySelectorAll('fieldset[data-option-name]')) {
      const name = fieldset.dataset.optionName;
      const checked = fieldset.querySelector('input:checked');
      if (name && checked instanceof HTMLInputElement) selection[name] = checked.value;
    }

    for (const select of picker.querySelectorAll('select[data-option-name]')) {
      const name = select.dataset.optionName;
      if (name && select.value) selection[name] = select.value;
    }

    if (selection.Dimensione || selection.Misure) {
      return { dimensione: selection.Dimensione, misure: selection.Misure };
    }
  }

  return null;
}

/**
 * @typedef {object} UpsellVariant
 * @property {number} id
 * @property {boolean} available
 * @property {string} price
 * @property {string} [compareAt]
 * @property {string} [soloPrice]
 * @property {string} [dimensione]
 * @property {string} [misure]
 * @property {string} [sizeLabel]
 *
 * @typedef {object} UpsellRow
 * @property {HTMLElement} element
 * @property {'topper' | 'gift'} role
 * @property {number} productId
 * @property {boolean} linked
 * @property {UpsellVariant[]} variants
 * @property {UpsellVariant | null} matched
 */

class ProductUpsell extends HTMLElement {
  /** @type {UpsellRow[]} */
  #rows = [];

  /** @type {{items?: Array<Object>, item_count?: number} | null} */
  #cart = null;

  #busy = false;

  #abortController = new AbortController();

  connectedCallback() {
    this.#rows = Array.from(this.querySelectorAll('[data-upsell-row]'))
      .map((element) => {
        const source = element.querySelector('[data-upsell-variants]');
        let variants = [];

        try {
          variants = JSON.parse(source?.textContent ?? '[]');
        } catch {
          return null;
        }

        return {
          element,
          role: element.dataset.upsellRole === 'gift' ? 'gift' : 'topper',
          productId: Number(element.dataset.productId),
          linked: element.dataset.linked === 'true',
          variants,
          matched: null,
        };
      })
      .filter(Boolean);

    if (this.#rows.length === 0) return;

    const { signal } = this.#abortController;

    this.addEventListener('click', this.#handleClick, { signal });

    // The picker checks the real radio during the capture phase of `change`, and
    // morphs itself once the fetch resolves. Listening to both keeps rows in step.
    document.addEventListener('change', this.#syncSizes, { signal });
    document.addEventListener(ThemeEvents.variantUpdate, this.#syncSizes, { signal });
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleExternalCartUpdate, { signal });

    this.#syncSizes();
    this.#refreshCart({ announce: false });
  }

  disconnectedCallback() {
    this.#abortController.abort();
  }

  get #giftEnabled() {
    return this.dataset.giftEnabled === 'true';
  }

  get #soloPercent() {
    return Number(this.dataset.soloPercent ?? 0);
  }

  get #toppers() {
    return this.#rows.filter((row) => row.role === 'topper');
  }

  get #gift() {
    return this.#rows.find((row) => row.role === 'gift') ?? null;
  }

  /** @returns {Array<Object>} */
  #items() {
    return Array.isArray(this.#cart?.items) ? this.#cart.items : [];
  }

  /** @param {UpsellRow} row */
  #itemsOf(row) {
    return this.#items().filter((item) => item.product_id === row.productId);
  }

  #topperInCart() {
    return this.#toppers.find((row) => this.#itemsOf(row).length > 0) ?? null;
  }

  /** Resolves which variant of each row matches the main product's selection. */
  #syncSizes = () => {
    const selection = readMainSelection();

    for (const row of this.#rows) {
      if (row.role === 'gift' || !row.linked) {
        row.matched = row.variants.find((variant) => variant.available) ?? row.variants[0] ?? null;
        continue;
      }

      if (!selection?.dimensione || !selection.misure) {
        row.matched = null;
        continue;
      }

      row.matched =
        row.variants.find(
          (variant) => variant.dimensione === selection.dimensione && variant.misure === selection.misure
        ) ?? null;
    }

    this.#render();
  };

  #render() {
    const selection = readMainSelection();
    const selectedTopper = this.#topperInCart();

    for (const row of this.#rows) {
      const { element } = row;
      const inCart = this.#itemsOf(row).length > 0;
      const addButton = element.querySelector('[data-upsell-add]');
      const addLabel = element.querySelector('[data-upsell-add-label]');
      const removeButton = element.querySelector('[data-upsell-remove]');
      const priceElement = element.querySelector('[data-upsell-price]');
      const compareElement = element.querySelector('[data-upsell-compare]');
      const badgeElement = element.querySelector('[data-upsell-badge]');
      const metaElement = element.querySelector('[data-upsell-meta]');
      const sizeElement = element.querySelector('[data-upsell-size]');

      element.toggleAttribute('data-selected', inCart);
      if (addButton instanceof HTMLButtonElement) addButton.hidden = inCart;
      if (removeButton instanceof HTMLElement) removeButton.hidden = !inCart;

      if (row.role === 'topper') {
        // A size-linked topper has nothing to inherit on a page without sizes.
        if (row.linked && !selection) {
          element.hidden = true;
          continue;
        }

        element.hidden = false;

        const purchasable = Boolean(row.matched?.available);

        if (addButton instanceof HTMLButtonElement) {
          addButton.disabled = !purchasable;
          if (addLabel) {
            addLabel.textContent = purchasable
              ? addButton.dataset.labelDefault ?? ''
              : addButton.dataset.labelUnavailable ?? '';
          }
        }

        if (metaElement instanceof HTMLElement && sizeElement) {
          const line = this.#itemsOf(row)[0];
          const sizeText = inCart ? line?.variant_title ?? '' : row.matched?.sizeLabel ?? '';
          sizeElement.textContent = sizeText;
          metaElement.hidden = !sizeText;
        }

        if (row.matched) {
          if (priceElement) priceElement.textContent = row.matched.price;
          if (compareElement instanceof HTMLElement) {
            compareElement.hidden = !row.matched.compareAt;
            compareElement.textContent = row.matched.compareAt ?? '';
          }
        }

        continue;
      }

      // Gift row.
      const variant = row.matched;

      if (!variant) {
        element.hidden = true;
        continue;
      }

      element.hidden = false;

      const isFree = Boolean(selectedTopper) && this.#giftEnabled;
      const hasSoloDiscount = this.#soloPercent > 0;
      const struckPrice = variant.compareAt ?? variant.price;

      if (badgeElement instanceof HTMLElement) {
        const badgeText = isFree ? element.dataset.giftBadge ?? '' : hasSoloDiscount ? element.dataset.soloBadge ?? '' : '';
        badgeElement.textContent = badgeText;
        badgeElement.hidden = !badgeText;
      }

      if (priceElement) {
        priceElement.textContent = isFree
          ? element.dataset.freeLabel ?? ''
          : hasSoloDiscount
            ? variant.soloPrice ?? variant.price
            : variant.price;
      }

      if (compareElement instanceof HTMLElement) {
        const showCompare = isFree || hasSoloDiscount || Boolean(variant.compareAt);
        compareElement.hidden = !showCompare;
        compareElement.textContent = showCompare ? struckPrice : '';
      }

      if (addButton instanceof HTMLButtonElement) {
        addButton.disabled = !variant.available;
        if (addLabel) {
          addLabel.textContent = variant.available
            ? addButton.dataset.labelDefault ?? ''
            : addButton.dataset.labelUnavailable ?? '';
        }
      }
    }
  }

  /** @param {MouseEvent} event */
  #handleClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const rowElement = target?.closest('[data-upsell-row]');
    if (!rowElement) return;

    const row = this.#rows.find((candidate) => candidate.element === rowElement);
    if (!row) return;

    if (target?.closest('[data-upsell-add]')) {
      event.preventDefault();
      if (row.role === 'topper') this.#addTopper(row);
      else this.#addGift(row);
    } else if (target?.closest('[data-upsell-remove]')) {
      event.preventDefault();
      if (row.role === 'topper') this.#removeTopper(row);
      else this.#removeGift(row);
    }
  };

  /**
   * Adds a topper in the size inherited from the main product. The other topper
   * is removed first (mutually exclusive choice) and the gift pillow is added
   * alongside, flagged as such, unless it is already in the cart.
   *
   * @param {UpsellRow} row
   */
  async #addTopper(row) {
    if (this.#busy || !row.matched?.available) return;
    this.#setBusy(true);

    try {
      const updates = {};
      for (const other of this.#toppers) {
        if (other === row) continue;
        for (const item of this.#itemsOf(other)) updates[item.variant_id] = 0;
      }
      if (Object.keys(updates).length > 0) await this.#update(updates);

      const items = [{ id: row.matched.id, quantity: 1 }];
      const gift = this.#gift;

      if (this.#giftEnabled && gift?.matched?.available && this.#itemsOf(gift).length === 0) {
        items.push({ id: gift.matched.id, quantity: 1, properties: this.#giftProperties() });
      }

      await this.#add(items);
      await this.#refreshCart({ announce: true });
    } catch (error) {
      console.error(error);
    } finally {
      this.#setBusy(false);
    }
  }

  /**
   * Removes a topper. If it was the last topper, the pillow lines that were
   * auto-added as a gift are removed too; a pillow the customer added on its
   * own (no gift flag) is left in the cart.
   *
   * @param {UpsellRow} row
   */
  async #removeTopper(row) {
    if (this.#busy) return;
    this.#setBusy(true);

    try {
      const updates = {};
      for (const item of this.#itemsOf(row)) updates[item.variant_id] = 0;
      if (Object.keys(updates).length > 0) await this.#update(updates);

      const gift = this.#gift;
      const otherTopperStillInCart = this.#toppers.some(
        (other) => other !== row && this.#itemsOf(other).length > 0
      );

      if (gift && !otherTopperStillInCart) {
        const flaggedLines = this.#itemsOf(gift).filter((item) => item.properties?.[GIFT_FLAG]);
        for (const line of flaggedLines) await this.#change(line.key, 0);
      }

      await this.#refreshCart({ announce: true });
    } catch (error) {
      console.error(error);
    } finally {
      this.#setBusy(false);
    }
  }

  /** @param {UpsellRow} row */
  async #addGift(row) {
    if (this.#busy || !row.matched?.available) return;
    this.#setBusy(true);

    try {
      const item = { id: row.matched.id, quantity: 1 };
      if (this.#giftEnabled && this.#topperInCart()) item.properties = this.#giftProperties();

      await this.#add([item]);
      await this.#refreshCart({ announce: true });
    } catch (error) {
      console.error(error);
    } finally {
      this.#setBusy(false);
    }
  }

  /** @param {UpsellRow} row */
  async #removeGift(row) {
    if (this.#busy) return;
    this.#setBusy(true);

    try {
      const updates = {};
      for (const item of this.#itemsOf(row)) updates[item.variant_id] = 0;
      if (Object.keys(updates).length > 0) await this.#update(updates);

      await this.#refreshCart({ announce: true });
    } catch (error) {
      console.error(error);
    } finally {
      this.#setBusy(false);
    }
  }

  #giftProperties() {
    const properties = { [GIFT_FLAG]: '1' };
    const note = this.dataset.giftCartProperty;
    if (note) properties[GIFT_PROPERTY_LABEL] = note;
    return properties;
  }

  /** @param {Array<{id: number, quantity: number, properties?: Object}>} items */
  async #add(items) {
    const response = await fetch(
      Theme.routes.cart_add_url,
      fetchConfig('json', { body: JSON.stringify({ items }) })
    );
    const data = await response.json();
    if (data.status) throw new Error(data.description ?? data.message ?? 'Cart add failed');
    return data;
  }

  /** @param {Record<string, number>} updates */
  async #update(updates) {
    const response = await fetch(
      `${Theme.routes.cart_update_url}.js`,
      fetchConfig('json', { body: JSON.stringify({ updates }) })
    );
    const data = await response.json();
    if (data.status) throw new Error(data.description ?? data.message ?? 'Cart update failed');
    return data;
  }

  /**
   * Removes a single line by its key, so gift lines can be told apart from a
   * pillow the customer is paying for.
   *
   * @param {string} key
   * @param {number} quantity
   */
  async #change(key, quantity) {
    const response = await fetch(
      `${Theme.routes.cart_change_url}.js`,
      fetchConfig('json', { body: JSON.stringify({ id: key, quantity }) })
    );
    const data = await response.json();
    if (data.status) throw new Error(data.description ?? data.message ?? 'Cart change failed');
    return data;
  }

  /** @param {{announce: boolean}} options */
  async #refreshCart({ announce }) {
    try {
      const response = await fetch(`${Theme.routes.cart_url}.js`);
      this.#cart = await response.json();
    } catch (error) {
      console.error(error);
      return;
    }

    if (announce) {
      document.dispatchEvent(
        new CartUpdateEvent(this.#cart, this.id || 'product-upsell', {
          itemCount: this.#cart?.item_count ?? 0,
          source: 'product-upsell',
        })
      );
    }

    this.#render();
  }

  /** @param {CustomEvent} event */
  #handleExternalCartUpdate = (event) => {
    if (event.detail?.data?.source === 'product-upsell') return;

    const resource = event.detail?.resource;

    if (Array.isArray(resource?.items)) {
      this.#cart = resource;
      this.#render();
    } else {
      this.#refreshCart({ announce: false });
    }
  };

  /** @param {boolean} busy */
  #setBusy(busy) {
    this.#busy = busy;
    this.toggleAttribute('data-busy', busy);
  }
}

if (!customElements.get('product-upsell')) {
  customElements.define('product-upsell', ProductUpsell);
}
