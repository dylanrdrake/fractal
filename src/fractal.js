import { FlowStateComponent, flowCompute, flowWatch } from 'flow-state';

/**
 * <fractal-view> — a resizable two-panel layout web component.
 *
 * Attributes:
 *   split            "v" (left|right, default) | "h" (top|bottom)
 *   initial-size     Percentage of space given to the first panel (default 50)
 *   min-size         Minimum first-panel size in % (default 10)
 *   max-size         Maximum first-panel size in % (default 90)
 *   divider          Bare attribute — add it to render a divider between the
 *                    panels, draggable subject to `resizable` (default: no
 *                    divider). Without it, panels are locked at their split
 *                    (still set via `initial-size`/`resize()`), with no
 *                    reserved gap — the divider's space goes to the panels.
 *   resizable        Set to "false" to disable drag-to-resize on a rendered
 *                    divider (default enabled; irrelevant without `divider`)
 *   divider-width    Divider thickness in px when rendered (default 8)
 *
 * Slots:
 *   first            Content for the first (left / top) panel
 *   second           Content for the second (right / bottom) panel
 *
 *   Add a `grow-on-hover` attribute directly on the element assigned to a
 *   slot (not on <fractal-view> itself) to opt just that panel into the
 *   hover-to-grow effect. A bare attribute grows by 15 percentage points;
 *   a numeric value (e.g. grow-on-hover="25") sets a custom amount.
 *   Checked live, so each panel's hover response is independent.
 *
 * Methods:
 *   resize(size)     Programmatically set the first-panel size (%)
 *
 * Events:
 *   sizechange       Fired (detail: { size }) whenever the first-panel size
 *                    changes, whether from resize(), a drag, or externally.
 *
 * CSS custom properties (set on the host, not consumed internally):
 *   --fractal-depth  Number of ancestor <fractal-view> elements this
 *                    instance is nested inside (0 for a top-level instance).
 *                    Exposed for consumer styling (e.g. tapering divider
 *                    thickness/color with nesting depth) — purely
 *                    informational otherwise.
 */
export class Fractal extends FlowStateComponent {
  shadowMode = 'open';

  // ── Drag state ────────────────────────────────────────────────────────────
  #dragging = false;

  // Bound handler references kept for clean removal.
  #onMouseMoveBound = (e) => this.#onMouseMove(e);
  #onMouseUpBound = () => this.#onMouseUp();

  // ── Hover-grow state ──────────────────────────────────────────────────────
  #firstPanelEl = null;
  #dividerEl = null;
  #firstSlotEl = null;
  #secondSlotEl = null;
  #defaultGrowAmount = 15;

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

      /* Only applied while a hover-triggered grow is in play — kept off
         during drags so resizing tracks the cursor with no lag. */
      .first-panel.grow-transition {
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
    const divider = this.hasAttribute('divider');
    const resizable = this.getAttribute('resizable') !== 'false';
    const dividerwidth = parseInt(this.getAttribute('divider-width') ?? '8', 10);
    const minsize = parseFloat(this.getAttribute('min-size') ?? '10');
    const maxsize = parseFloat(this.getAttribute('max-size') ?? '90');

    // Expose nesting depth as a custom property for consumer styling.
    // Slotted content (including a nested <fractal-view>) stays in the light
    // DOM under its original parent, so a plain parentElement walk finds
    // every ancestor <fractal-view> with no shadow-boundary crossing needed.
    let depth = 0;
    for (let el = this.parentElement; el; el = el.parentElement) {
      if (el.tagName === 'FRACTAL-VIEW') depth++;
    }
    this.style.setProperty('--fractal-depth', String(depth));

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
        divider,
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
        // left over after the divider's fixed thickness (0 when no divider
        // is rendered, so its space goes to the panels) so it can never push
        // the divider past the container's edge (e.g. at size=100). Hover
        // grow is layered on as a clamped offset to the true `size`.
        firststyle: flowCompute(
          (size, split, divider, dividerwidth, hoverboost) => {
            const effectiveSize = Math.max(minsize, Math.min(maxsize, size + hoverboost));
            const effectiveDividerWidth = divider ? dividerwidth : 0;
            const basis = `calc((100% - ${effectiveDividerWidth}px) * ${effectiveSize} / 100)`;
            return split === 'v'
              ? `flex: 0 0 ${basis}; width: ${basis};`
              : `flex: 0 0 ${basis}; height: ${basis};`;
          },
          ['size', 'split', 'divider', 'dividerwidth', 'hoverboost']
        ),

        // Divider: collapsed to zero size and non-interactive unless
        // `divider` is set; otherwise fixed thickness + cursor based on
        // split and resizability.
        dividerstyle: flowCompute(
          (split, divider, resizable, dividerwidth) => {
            const width = divider ? dividerwidth : 0;
            const pointerEvents = divider ? 'auto' : 'none';
            const cursor = divider && resizable
              ? split === 'v' ? 'ew-resize' : 'ns-resize'
              : 'default';
            return split === 'v'
              ? `width: ${width}px; height: 100%; cursor: ${cursor}; pointer-events: ${pointerEvents};`
              : `height: ${width}px; width: 100%; cursor: ${cursor}; pointer-events: ${pointerEvents};`;
          },
          ['split', 'divider', 'resizable', 'dividerwidth']
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
    this.#dividerEl = this.shadowRoot?.querySelector('.divider') ?? null;
    this.#dividerEl?.addEventListener('mousedown', (e) => this.#onDividerMouseDown(e));

    // Wire up hover-to-grow on both panels.
    this.#firstPanelEl = this.shadowRoot?.querySelector('.first-panel') ?? null;
    const secondPanelEl = this.shadowRoot?.querySelector('.second-panel');
    this.#firstSlotEl = this.shadowRoot?.querySelector('slot[name="first"]') ?? null;
    this.#secondSlotEl = this.shadowRoot?.querySelector('slot[name="second"]') ?? null;
    this.#firstPanelEl?.addEventListener('mouseenter', () => this.#onPanelHover('first'));
    this.#firstPanelEl?.addEventListener('mouseleave', (e) => this.#onPanelLeave(e));
    secondPanelEl?.addEventListener('mouseenter', () => this.#onPanelHover('second'));
    secondPanelEl?.addEventListener('mouseleave', (e) => this.#onPanelLeave(e));
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
    return ['split', 'divider', 'resizable'];
  }

  attributeChangedCallback(name, _oldVal, newVal) {
    if (!this.source?.update) return;
    if (name === 'split') {
      this.source.update({ split: newVal ?? 'v' });
    } else if (name === 'divider') {
      // Bare/presence attribute: newVal is null when removed, a string
      // (possibly empty) when present.
      this.source.update({ divider: newVal !== null });
    } else if (name === 'resizable') {
      this.source.update({ resizable: newVal !== 'false' });
    }
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────
  #onDividerMouseDown(e) {
    if (!this.source?.update) return;
    // Check live attributes so this stays in sync if changed externally.
    // The divider is already zero-size/pointer-events:none without
    // `divider`, but bail explicitly too as a defensive backstop.
    if (!this.hasAttribute('divider') || this.getAttribute('resizable') === 'false') return;

    e.preventDefault();
    this.#dragging = true;
    // Cancel any hover grow in progress so dragging starts from the true
    // size, with no leftover transition to make it lag behind the cursor.
    this.#firstPanelEl?.classList.remove('grow-transition');
    this.source.update({ hoverboost: 0 });
    window.addEventListener('mousemove', this.#onMouseMoveBound);
    window.addEventListener('mouseup', this.#onMouseUpBound);
  }

  // ── Hover-grow handler ────────────────────────────────────────────────────
  #onPanelHover(which) {
    if (!this.source?.update || this.#dragging) return;

    // Entering a panel only grows it if the element actually assigned to
    // that slot opts in via its own `grow-on-hover` attribute — checked live
    // against the current assignment, so each panel's hover response is
    // independent and unaffected by <fractal-view>'s own attributes. A
    // numeric value (e.g. grow-on-hover="25") sets a custom amount; a
    // bare/non-numeric value falls back to the default.
    let amount = this.#defaultGrowAmount;
    if (which !== null) {
      const slotEl = which === 'first' ? this.#firstSlotEl : this.#secondSlotEl;
      const growEl = slotEl?.assignedElements().find((el) => el.hasAttribute('grow-on-hover'));
      if (!growEl) return;
      const override = parseFloat(growEl.getAttribute('grow-on-hover'));
      if (!Number.isNaN(override)) amount = override;
    }

    this.#firstPanelEl?.classList.add('grow-transition');
    const hoverboost = which === 'first' ? amount : which === 'second' ? -amount : 0;
    this.source.update({ hoverboost });
  }

  // Moving from a panel onto the divider isn't a real "leave" for hover-grow
  // purposes — the divider's position tracks the panel's live size, so
  // shrinking back mid-crossing would drag it out from under the cursor
  // right as the user tries to grab it. Keep whichever panel is grown grown
  // until the cursor lands in the other panel or leaves the component.
  #onPanelLeave(e) {
    if (e.relatedTarget === this.#dividerEl) return;
    this.#onPanelHover(null);
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
