# Fractal

A custom web component for resizable split-panel layouts — `<fractal-view>` renders two panels separated by a draggable divider, powered internally by [flow-state](https://github.com/dylanrdrake/flow-state) for reactive, attribute-driven styling. `flow-state` is bundled into the build, so there's nothing else to install.

- 🪟 Two-panel split layout, vertical (left | right) or horizontal (top | bottom)
- 🖱️ Drag-to-resize divider, with min/max clamping
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

<fractal-view split="v" initial-size="35" min-size="10" max-size="90">
  <div slot="first">Sidebar</div>
  <div slot="second">Main content</div>
</fractal-view>
```

`<fractal-view>` fills its container, so give it explicit dimensions (e.g. `height: 100vh` or place it inside a flex/grid parent).

### Nesting

Panels can be nested by placing a `<fractal-view>` inside a slot of another:

```html
<fractal-view split="v" initial-size="40">
  <fractal-view slot="first" split="h" initial-size="50">
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
| `initial-size`    | number (%)          | `50`    | Starting size of the first panel. Read once on connect.    |
| `min-size`        | number (%)          | `10`    | Minimum size the first panel can be dragged to.             |
| `max-size`        | number (%)          | `90`    | Maximum size the first panel can be dragged to.             |
| `resizable`       | `"false"` to disable | enabled | Set to `"false"` to lock the divider. Reactive.            |
| `divider-width`   | number (px)          | `8`     | Thickness of the divider. Read once on connect.             |

Only `split` and `resizable` are observed/reactive after the element connects; the others are read at connect time.

## Slots

| Slot       | Content                          |
| ---------- | --------------------------------- |
| `first`    | Left panel (or top, when `split="h"`)  |
| `second`   | Right panel (or bottom, when `split="h"`) |

## Methods

### `resize(size)`

Programmatically sets the first panel's size (percentage, clamped to `min-size`/`max-size`).

```js
document.querySelector('fractal-view').resize(60);
```

## Events

### `sizechange`

Fired on the `<fractal-view>` element whenever the first panel's size changes — whether from `resize()`, dragging the divider, or an attribute change. `detail.size` is the new percentage. The event bubbles and is composed, so it can be listened for from outside the element's shadow DOM.

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

`demo/index.html` imports the built `fractal` package via an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap) pointing at `../dist/fractal.js` — run `npm run build` at least once (and after any `src/` changes) before `npm run dev`, or the demo will be serving a stale bundle.

See `demo/index.html` for a full example with vertical, horizontal, and nested panels, plus slider/button controls demonstrating two-way binding.

## License

MIT © Dylan Drake
