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
 *   Checked live, so each panel's hover response is independent. While
 *   grown, that same element gets a `grown` attribute (removed again on
 *   collapse) — style off it directly, e.g. `[grow-on-hover][grown] { ... }`.
 *
 *   `grow-on-click` works the same way but grows on click instead of hover.
 *   It's one-directional: clicking anywhere in the panel grows it and sets
 *   `grown`, and there's no click-driven way to collapse it back — it
 *   doesn't collapse on cursor-leave, and re-clicking (that panel or the
 *   other one) doesn't collapse it either. Independent of `grow-on-hover` —
 *   an element can carry either or both, with their own amounts, and their
 *   boosts stack. Call `collapseGrow()` on the <fractal-view> to reset it
 *   from the outside (e.g. a close button inside the grown panel).
 *
 * Methods:
 *   resize(size)     Programmatically set the first-panel size (%)
 *   collapseGrow()   Reset any active hover/click grow (both panels) back
 *                    to 0 immediately. Mainly for grow-on-click, which has
 *                    no built-in way to collapse itself.
 *
 * Events:
 *   sizechange       Fired (detail: { size }) whenever the first-panel size
 *                    changes, whether from resize(), a drag, or externally.
 *   panelgrow        Fired (detail: { panel, grown }) whenever a panel's
 *                    combined grow state (hover and/or click) toggles on
 *                    or off. `panel` is 'first' or 'second' (whichever
 *                    panel is growing or just stopped growing); `grown` is
 *                    true when it just grew, false when it just collapsed
 *                    back. Dispatched both on <fractal-view> itself and
 *                    directly on the grow-on-hover/grow-on-click element,
 *                    so you can listen on either.
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

  // ── Grow state ────────────────────────────────────────────────────────────
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

    // Declare the config before super reads it; `source` then holds the instance.
    this.sourceConfig = {
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
      // Same idea, but pinned on/off by a grow-on-click toggle instead of
      // continuous hover. Stacks additively with hoverboost.
      clickboost: 0,

      // Combined grow offset driving both layout and the grown/panelgrow
      // reporting below, so hover and click grow read as one state.
      boost: flowCompute(
        (hoverboost, clickboost) => hoverboost + clickboost,
        ['hoverboost', 'clickboost']
      ),

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
        (size, split, divider, dividerwidth, boost) => {
          const effectiveSize = Math.max(minsize, Math.min(maxsize, size + boost));
          const effectiveDividerWidth = divider ? dividerwidth : 0;
          const basis = `calc((100% - ${effectiveDividerWidth}px) * ${effectiveSize} / 100)`;
          return split === 'v'
            ? `flex: 0 0 ${basis}; width: ${basis};`
            : `flex: 0 0 ${basis}; height: ${basis};`;
        },
        ['size', 'split', 'divider', 'dividerwidth', 'boost']
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
    };

    // FlowStateComponent reads this.sourceConfig, initialises FlowState, stamps template.
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

    // Emit `panelgrow` whenever a panel's combined grow state (hover and/or
    // click) toggles on or off. boost's sign identifies the panel (positive
    // → first, negative → second); a direct sign flip with no stop at 0 in
    // between (e.g. hover-grow one panel while the other is already
    // click-grown) is reported as a collapse of the old panel followed by a
    // grow of the new one.
    let prevBoost = 0;
    let firstBoostEmit = true;
    flowWatch(this, 'boost', (boost) => {
      if (firstBoostEmit) {
        firstBoostEmit = false;
        prevBoost = boost;
        return;
      }
      if (boost === prevBoost) return;

      const wasGrown = prevBoost > 0 ? 'first' : prevBoost < 0 ? 'second' : null;
      const isGrown = boost > 0 ? 'first' : boost < 0 ? 'second' : null;

      if (wasGrown && wasGrown !== isGrown) {
        this.#emitPanelGrow(wasGrown, false);
      }
      if (isGrown && isGrown !== wasGrown) {
        this.#emitPanelGrow(isGrown, true);
      }

      prevBoost = boost;
    });

    // Wire up drag-resize on the now-stamped divider.
    this.#dividerEl = this.shadowRoot?.querySelector('.divider') ?? null;
    this.#dividerEl?.addEventListener('mousedown', (e) => this.#onDividerMouseDown(e));
    this.#dividerEl?.addEventListener('mouseleave', (e) => this.#onDividerLeave(e));

    // Wire up hover-to-grow on both panels.
    this.#firstPanelEl = this.shadowRoot?.querySelector('.first-panel') ?? null;
    const secondPanelEl = this.shadowRoot?.querySelector('.second-panel');
    this.#firstSlotEl = this.shadowRoot?.querySelector('slot[name="first"]') ?? null;
    this.#secondSlotEl = this.shadowRoot?.querySelector('slot[name="second"]') ?? null;
    this.#firstPanelEl?.addEventListener('mouseenter', () => this.#onPanelHover('first'));
    this.#firstPanelEl?.addEventListener('mouseleave', (e) => this.#onPanelLeave(e));
    secondPanelEl?.addEventListener('mouseenter', () => this.#onPanelHover('second'));
    secondPanelEl?.addEventListener('mouseleave', (e) => this.#onPanelLeave(e));

    // Wire up click-to-grow on both panels.
    this.#firstPanelEl?.addEventListener('click', () => this.#onPanelClick('first'));
    secondPanelEl?.addEventListener('click', () => this.#onPanelClick('second'));
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

  /**
   * Reset any active hover/click grow (both panels) back to 0 immediately.
   * The grow-transition class is left in place, so this animates back
   * rather than snapping (unlike the drag-start reset, which snaps).
   */
  collapseGrow() {
    if (!this.source?.update) return;
    this.source.update({ hoverboost: 0, clickboost: 0 });
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
    // Cancel any hover/click grow in progress so dragging starts from the
    // true size, with no leftover transition to make it lag behind the
    // cursor and no stale boost skewing the dragged size.
    this.#firstPanelEl?.classList.remove('grow-transition');
    this.source.update({ hoverboost: 0, clickboost: 0 });
    window.addEventListener('mousemove', this.#onMouseMoveBound);
    window.addEventListener('mouseup', this.#onMouseUpBound);
  }

  // The element assigned to a slot that opts into grow via the given
  // attribute ('grow-on-hover' or 'grow-on-click') — checked live against
  // the current assignment, so each panel's response is independent and
  // unaffected by <fractal-view>'s own attributes.
  #assignedGrowElFor(which, attr) {
    const slotEl = which === 'first' ? this.#firstSlotEl : this.#secondSlotEl;
    return slotEl?.assignedElements().find((el) => el.hasAttribute(attr)) ?? null;
  }

  #growElFor(which) {
    return this.#assignedGrowElFor(which, 'grow-on-hover');
  }

  #clickGrowElFor(which) {
    return this.#assignedGrowElFor(which, 'grow-on-click');
  }

  // Toggles the `grown` attribute and fires `panelgrow` on both the
  // <fractal-view> host (for listeners tracking the component as a whole)
  // and directly on the grow-on-hover/grow-on-click element itself (so
  // listeners scoped to that panel — e.g.
  // `#side-bar.addEventListener('panelgrow', ...)` — don't need to filter
  // by `detail.panel`).
  #emitPanelGrow(which, grown) {
    const detail = { panel: which, grown };
    const growEl = this.#growElFor(which) ?? this.#clickGrowElFor(which);
    if (grown) {
      growEl?.setAttribute('grown', '');
    } else {
      growEl?.removeAttribute('grown');
    }
    this.dispatchEvent(new CustomEvent('panelgrow', { detail, bubbles: true, composed: true }));
    growEl?.dispatchEvent(new CustomEvent('panelgrow', { detail, bubbles: true, composed: true }));
  }

  // ── Hover-grow handler ────────────────────────────────────────────────────
  #onPanelHover(which) {
    if (!this.source?.update || this.#dragging) return;

    // A numeric value (e.g. grow-on-hover="25") sets a custom amount; a
    // bare/non-numeric value falls back to the default.
    let amount = this.#defaultGrowAmount;
    let effectiveWhich = which;
    if (which !== null) {
      const growEl = this.#growElFor(which);
      if (growEl) {
        const override = parseFloat(growEl.getAttribute('grow-on-hover'));
        if (!Number.isNaN(override)) amount = override;
      } else {
        // The panel we landed in doesn't opt in — that's a revert, not a
        // no-op, since a different panel may currently be hover-grown (e.g.
        // crossing the divider straight into a non-grow panel).
        effectiveWhich = null;
      }
    }

    this.#firstPanelEl?.classList.add('grow-transition');
    const hoverboost = effectiveWhich === 'first' ? amount : effectiveWhich === 'second' ? -amount : 0;
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

  // Resolve which slot (if any) a node landed in by walking up to the
  // node's ancestor that is a direct light-DOM child of this host, then
  // reading its `slot` attribute. Used on divider-leave instead of relying
  // on the destination panel's own mouseenter firing afterward — important
  // when a panel's content is itself a nested <fractal-view>: crossing into
  // its shadow tree retargets relatedTarget to the nested host element (a
  // light-DOM child of *this* component), and there's no guarantee our own
  // shadow-root panel wrapper gets a reliable mouseenter out of that.
  #panelForNode(node) {
    let el = node;
    while (el && el.parentElement !== this) el = el.parentElement;
    if (!el) return null;
    const slot = el.getAttribute?.('slot');
    return slot === 'first' ? 'first' : slot === 'second' ? 'second' : null;
  }

  // Leaving the divider reverts hover-grow unless the cursor landed
  // directly on the other panel that itself opts into hover-grow (handled
  // via #onPanelHover, which only touches hoverboost — any pinned
  // grow-on-click state is left alone).
  #onDividerLeave(e) {
    this.#onPanelHover(this.#panelForNode(e.relatedTarget));
  }

  // ── Click-grow handler ────────────────────────────────────────────────────
  // One-directional, unlike hover: clicking a grow-on-click panel grows it
  // and it stays grown — including through mouseleave, and through
  // re-clicking that same panel — with no click-driven way to collapse it
  // again. (It's still reset to 0 on drag start, same as hoverboost.)
  // Clicking a panel with no `grow-on-click` is a no-op.
  #onPanelClick(which) {
    if (!this.source?.update || this.#dragging) return;

    const growEl = this.#clickGrowElFor(which);
    if (!growEl) return;

    let amount = this.#defaultGrowAmount;
    const override = parseFloat(growEl.getAttribute('grow-on-click'));
    if (!Number.isNaN(override)) amount = override;

    this.#firstPanelEl?.classList.add('grow-transition');
    this.source.update({ clickboost: which === 'first' ? amount : -amount });
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
