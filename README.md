# Fractal

A custom web component for two-panel layouts — `<fractal-view>` renders two panels, optionally separated by a draggable divider, powered internally by [flow-state](https://github.com/dylanrdrake/flow-state) for reactive, attribute-driven styling. `flow-state` is bundled into the build, so there's nothing else to install.

- 🪟 Two-panel layout, vertical (left | right) or horizontal (top | bottom)
- 🖱️ Opt-in drag-to-resize divider (`divider` attribute), with min/max clamping — without it, panels are locked at their split with no reserved gap
- 🔍 Hover-to-grow — opt any panel in with `grow-on-hover`; it grows on mouseover and settles back on mouse-out
- 🪆 Nestable — a `<fractal-view>` can live inside another's slot for arbitrary layouts
- 🎛️ Fully controllable via attributes or the `resize()` method, and observable via a standard `sizechange` event

## Install

```bash
npm install fractal
```

> **⚠️ Not yet published to npm.** `fractal` isn't on the npm registry yet, so `npm install` above won't work. For now, clone the repo and build it locally:
>
> ```bash
> git clone https://github.com/dylanrdrake/fractal.git
> cd fractal
> npm install
> npm run build
> ```
>
> Then point an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap) at the built file so the bare `fractal` specifier resolves in the browser:
>
> ```html
> <script type="importmap">
> {
>   "imports": {
>     "fractal": "./fractal/dist/fractal.js"
>   }
> }
> </script>
> <script type="module">
>   import 'fractal';
> </script>
> ```
>
> `flow-state` is only a `devDependency` used to build `fractal` itself (it gets bundled into `dist/fractal.js`) — consumers never need to install or reference it directly.

## Usage

```html
<script type="module">
  import 'fractal';
</script>

<fractal-view divider split="v" initial-size="35" min-size="10" max-size="90">
  <div slot="first">Sidebar</div>
  <div slot="second">Main content</div>
</fractal-view>
```

`<fractal-view>` fills its container, so give it explicit dimensions (e.g. `height: 100vh` or place it inside a flex/grid parent). Leave off `divider` for a locked, static split with no gap between the panels — see `divider` under Attributes below.

### Nesting

Panels can be nested by placing a `<fractal-view>` inside a slot of another:

```html
<fractal-view divider split="v" initial-size="40">
  <fractal-view divider slot="first" split="h" initial-size="50">
    <div slot="first">Top-left</div>
    <div slot="second">Bottom-left</div>
  </fractal-view>
  <div slot="second">Right</div>
</fractal-view>
```

## Attributes

| Attribute        | Values / type      | Default | Description                                             |
| ---------------- | ------------------ | ------- | --------------------------------------------------------- |
| `split`           | `"v"` \| `"h"`      | `"v"`   | `v` = left/right, `h` = top/bottom. Reactive.              |
| `divider`         | bare attribute       | no divider | Add it to render a divider between the panels. Without it, panels are locked at their split (still set via `initial-size`/`resize()`) with no reserved gap — the divider's space goes to the panels. Reactive. |
| `initial-size`    | number (%)          | `50`    | Starting size of the first panel. Read once on connect.    |
| `min-size`        | number (%)          | `10`    | Minimum size the first panel can be dragged to.             |
| `max-size`        | number (%)          | `90`    | Maximum size the first panel can be dragged to.             |
| `resizable`       | `"false"` to disable | enabled | Set to `"false"` to disable dragging a rendered divider (irrelevant without `divider`). Reactive. |
| `divider-width`   | number (px)          | `8`     | Thickness of the divider when rendered. Read once on connect. |

`split`, `divider`, and `resizable` are observed/reactive after the element connects; the rest are init-time config, read once on connect.

## Slots

| Slot       | Content                          |
| ---------- | --------------------------------- |
| `first`    | Left panel (or top, when `split="h"`)  |
| `second`   | Right panel (or bottom, when `split="h"`) |

### `grow-on-hover`

The hover-to-grow effect isn't a `<fractal-view>` attribute — it's opted into per panel by adding a `grow-on-hover` attribute to the *element assigned to that slot*. A bare attribute grows by 15 percentage points; a numeric value sets a custom amount for that panel. It's checked live, so each panel's hover response — enabled or not, and by how much — is independent of its sibling and of `<fractal-view>`'s own attributes.

```html
<fractal-view split="v">
  <div slot="first" grow-on-hover>Grows by 15 (the default)</div>
  <div slot="second" grow-on-hover="30">Grows by 30</div>
</fractal-view>
```

## Methods

### `resize(size)`

Programmatically sets the first panel's size (percentage, clamped to `min-size`/`max-size`).

```js
document.querySelector('fractal-view').resize(60);
```

## Events

### `sizechange`

Fired on the `<fractal-view>` element whenever the first panel's size changes — whether from `resize()`, dragging the divider, or an attribute change. `detail.size` is the new percentage. The event bubbles and is composed, so it can be listened for from outside the element's shadow DOM.

Hovering a panel with `grow-on-hover` (see Slots above) does *not* fire `sizechange` — the grow is a purely visual, temporary offset layered on top of the real size, not a change to it.

```js
panel.addEventListener('sizechange', (e) => {
  console.log(e.detail.size);
});
```

### Two-way sync

Combine `sizechange` with `resize()` to keep an external control (e.g. a slider) in sync in both directions:

```js
const panel = document.querySelector('fractal-view');
const slider = document.querySelector('input[type=range]');

// Slider → panel
slider.addEventListener('input', () => panel.resize(parseFloat(slider.value)));

// Panel → slider (e.g. keep the slider in sync while dragging the divider)
panel.addEventListener('sizechange', (e) => {
  slider.value = e.detail.size;
});
```

## Development

```bash
npm run build    # build dist/fractal.js (ESM) and dist/fractal.umd.cjs (UMD)
npm run dev      # serve the demo/ page with Vite
npm run preview  # preview the production build
```

`demo/index.html` imports `fractal` via an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap). Under `npm run dev`, Vite's own resolver takes priority over that import map and resolves the bare `fractal` specifier to `dist/fractal.js` via the package's own self-reference (`package.json`'s `exports`/`module` field) — so run `npm run build` after any `src/` change, or the demo will keep serving a stale bundle.

See `demo/index.html` for a full example with vertical, horizontal, and nested panels, plus slider/button controls demonstrating two-way binding.

## License

MIT © Dylan Drake
