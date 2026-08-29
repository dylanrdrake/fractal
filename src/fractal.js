import { FlowStateComponent, flowCompute, flowWatch } from 'flow-state';

/**
 * <fractal-view> — a resizable two-panel layout web component.
 *
 * Attributes:
 *   split            "v" (left|right, default) | "h" (top|bottom)
 *   initial-size     Percentage of space given to the first panel (default 50)
 *   min-size         Minimum first-panel size in % (default 10)
 *   max-size         Maximum first-panel size in % (default 90)
 *   resizable        Set to "false" to disable drag-to-resize (default enabled)
 *   divider-width    Divider thickness in px (default 8)
 *   zoom-on-hover    Set to "true" to enable the hover-to-grow effect (default disabled)
 *   zoom-amount      Percentage points a hovered panel grows by (default 15)
 *
 * Slots:
 *   first            Content for the first (left / top) panel
 *   second           Content for the second (right / bottom) panel
 *
 * Methods:
 *   resize(size)     Programmatically set the first-panel size (%)
 *
 * Events:
 *   sizechange       Fired (detail: { size }) whenever the first-panel size
 *                    changes, whether from resize(), a drag, or externally.
 */
export class Fractal extends FlowStateComponent {
  shadowMode = 'open';

  // ── Drag state ────────────────────────────────────────────────────────────
  #dragging = false;

  // Bound handler references kept for clean removal.
  #onMouseMoveBound = (e) => this.#onMouseMove(e);
  #onMouseUpBound = () => this.#onMouseUp();

  // ── Hover-zoom state ──────────────────────────────────────────────────────
  #firstPanelEl = null;
  #zoomOnHover = false;
  #zoomAmount = 15;

  // ── Styles ────────────────────────────────────────────────────────────────
  get styles() {
    return /* css */ `
      :host {
        display: block;
        width: 100%;
        height: 100%;
        overflow: hidden;
        box-sizing: border-box;
      }

      .container {
        display: flex;
        width: 100%;
        height: 100%;
        overflow: hidden;
        box-sizing: border-box;
      }

      .panel {
        overflow: hidden;
        min-width: 0;
        min-height: 0;
        box-sizing: border-box;
      }

      .second-panel {
        flex: 1 1 0;
      }

      .divider {
        flex-shrink: 0;
        background: #e5e7eb;
        transition: background 0.12s;
        user-select: none;
        -webkit-user-select: none;
        box-sizing: border-box;
      }

      .divider:hover {
        background: #9ca3af;
      }

      .divider:active {
        background: #6b7280;
      }

      /* Only applied while a hover-triggered zoom is in play — kept off
         during drags so resizing tracks the cursor with no lag. */
      .first-panel.zoom-transition {
        transition: flex-basis 0.18s ease, width 0.18s ease, height 0.18s ease;
      }
    `;
  }

  // ── Template ──────────────────────────────────────────────────────────────
  get template() {
    return /* html */ `
      <div class="container" flow-watch-containerstyle-to-attr="style">
        <div class="panel first-panel" flow-watch-firststyle-to-attr="style">
          <slot name="first"></slot>
        </div>
        <div class="divider" flow-watch-dividerstyle-to-attr="style"></div>
        <div class="panel second-panel">
          <slot name="second"></slot>
        </div>
      </div>
    `;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  connectedCallback() {
    const size = parseFloat(this.getAttribute('initial-size') ?? '50');
    const split = this.getAttribute('split') ?? 'v';
    const resizable = this.getAttribute('resizable') !== 'false';
    const dividerwidth = parseInt(this.getAttribute('divider-width') ?? '8', 10);
    const minsize = parseFloat(this.getAttribute('min-size') ?? '10');
    const maxsize = parseFloat(this.getAttribute('max-size') ?? '90');
    this.#zoomOnHover = this.getAttribute('zoom-on-hover') === 'true';
    this.#zoomAmount = parseFloat(this.getAttribute('zoom-amount') ?? '15');

    // Set the source own-property before super reads it.
    // Object.defineProperty is required because FlowStateComponent defines a
    // prototype getter `get source()` — a plain assignment would throw in strict
    // mode (ES modules).  Using defineProperty creates a shadowing own data
    // property that FlowStateComponent then reads and deletes, restoring the
    // prototype getter afterward.
    Object.defineProperty(this, 'source', {
      value: {
        size: Math.max(minsize, Math.min(maxsize, size)),
        split,
        resizable,
        dividerwidth,
        minsize,
        maxsize,
        // Ephemeral, hover-driven boost added on top of `size` — never
        // persisted and never affects `size` itself, so it can't leak into
        // `resize()`, drags, or the `sizechange` event.
        hoverboost: 0,

        // flex-direction on the container
        containerstyle: flowCompute(
          (split) =>
            split === 'v'
              ? 'flex-direction: row;'
              : 'flex-direction: column;',
          ['split']
        ),

        // First panel: fixed size via flex-basis, sized against the space
        // left over after the divider's fixed thickness so it can never push
        // the divider past the container's edge (e.g. at size=100). Hover
        // zoom is layered on as a clamped offset to the true `size`.
        firststyle: flowCompute(
          (size, split, dividerwidth, hoverboost) => {
            const effectiveSize = Math.max(minsize, Math.min(maxsize, size + hoverboost));
            const basis = `calc((100% - ${dividerwidth}px) * ${effectiveSize} / 100)`;
            return split === 'v'
              ? `flex: 0 0 ${basis}; width: ${basis};`
              : `flex: 0 0 ${basis}; height: ${basis};`;
          },
          ['size', 'split', 'dividerwidth', 'hoverboost']
        ),

        // Divider: fixed thickness + cursor based on split and resizability
        dividerstyle: flowCompute(
          (split, resizable, dividerwidth) => {
            const cursor = resizable
              ? split === 'v' ? 'ew-resize' : 'ns-resize'
              : 'default';
            return split === 'v'
              ? `width: ${dividerwidth}px; height: 100%; cursor: ${cursor};`
              : `height: ${dividerwidth}px; width: 100%; cursor: ${cursor};`;
          },
          ['split', 'resizable', 'dividerwidth']
        ),
      },
      configurable: true,
      writable: true,
      enumerable: true,
    });

    // FlowStateComponent reads this.source, initialises FlowState, stamps template.
    super.connectedCallback();

    // Emit `sizechange` whenever the internal size state changes (resize(),
    // drag, or an external update) — skip flowWatch's immediate initial call.
    let firstSizeEmit = true;
    flowWatch(this, 'size', (size) => {
      if (firstSizeEmit) {
        firstSizeEmit = false;
        return;
      }
      this.dispatchEvent(new CustomEvent('sizechange', { detail: { size }, bubbles: true, composed: true }));
    });

    // Wire up drag-resize on the now-stamped divider.
    this.shadowRoot
      ?.querySelector('.divider')
      ?.addEventListener('mousedown', (e) => this.#onDividerMouseDown(e));

    // Wire up hover-to-zoom on both panels.
    this.#firstPanelEl = this.shadowRoot?.querySelector('.first-panel') ?? null;
    const secondPanelEl = this.shadowRoot?.querySelector('.second-panel');
    this.#firstPanelEl?.addEventListener('mouseenter', () => this.#onPanelHover('first'));
    this.#firstPanelEl?.addEventListener('mouseleave', () => this.#onPanelHover(null));
    secondPanelEl?.addEventListener('mouseenter', () => this.#onPanelHover('second'));
    secondPanelEl?.addEventListener('mouseleave', () => this.#onPanelHover(null));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Guard: remove any window listeners left over from an interrupted drag.
    window.removeEventListener('mousemove', this.#onMouseMoveBound);
    window.removeEventListener('mouseup', this.#onMouseUpBound);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  /**
   * Programmatically set the first-panel size (clamped to min/max).
   * @param {number} size – percentage (0–100)
   */
  resize(size) {
    if (!this.source?.update) return;
    const minsize = parseFloat(this.getAttribute('min-size') ?? '10');
    const maxsize = parseFloat(this.getAttribute('max-size') ?? '90');
    this.source.update({ size: Math.max(minsize, Math.min(maxsize, size)) });
  }

  // ── Observed attributes ───────────────────────────────────────────────────
  static get observedAttributes() {
    return ['split', 'resizable'];
  }

  attributeChangedCallback(name, _oldVal, newVal) {
    if (!this.source?.update) return;
    if (name === 'split') {
      this.source.update({ split: newVal ?? 'v' });
    } else if (name === 'resizable') {
      this.source.update({ resizable: newVal !== 'false' });
    }
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────
  #onDividerMouseDown(e) {
    if (!this.source?.update) return;
    // Check live attribute so it stays in sync if changed externally.
    if (this.getAttribute('resizable') === 'false') return;

    e.preventDefault();
    this.#dragging = true;
    // Cancel any hover zoom in progress so dragging starts from the true
    // size, with no leftover transition to make it lag behind the cursor.
    this.#firstPanelEl?.classList.remove('zoom-transition');
    this.source.update({ hoverboost: 0 });
    window.addEventListener('mousemove', this.#onMouseMoveBound);
    window.addEventListener('mouseup', this.#onMouseUpBound);
  }

  // ── Hover-zoom handler ────────────────────────────────────────────────────
  #onPanelHover(which) {
    if (!this.source?.update || this.#dragging || !this.#zoomOnHover) return;

    this.#firstPanelEl?.classList.add('zoom-transition');
    const hoverboost = which === 'first' ? this.#zoomAmount : which === 'second' ? -this.#zoomAmount : 0;
    this.source.update({ hoverboost });
  }

  #onMouseMove(e) {
    if (!this.#dragging) return;

    const split = this.getAttribute('split') ?? 'v';
    const container = this.shadowRoot?.querySelector('.container');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    let newSize;

    if (split === 'v') {
      newSize = rect.width > 0
        ? ((e.clientX - rect.left) / rect.width) * 100
        : 50;
    } else {
      newSize = rect.height > 0
        ? ((e.clientY - rect.top) / rect.height) * 100
        : 50;
    }

    const minsize = parseFloat(this.getAttribute('min-size') ?? '10');
    const maxsize = parseFloat(this.getAttribute('max-size') ?? '90');
    this.source.update({ size: Math.max(minsize, Math.min(maxsize, newSize)) });
  }

  #onMouseUp() {
    if (!this.#dragging) return;
    this.#dragging = false;
    window.removeEventListener('mousemove', this.#onMouseMoveBound);
    window.removeEventListener('mouseup', this.#onMouseUpBound);
  }
}

customElements.define('fractal-view', Fractal);
