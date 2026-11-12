# Business presentation acceptance

Implements the fixture contract for [T1](https://github.com/CleverC2200/dsh-genui/issues/3), under [spec #2](https://github.com/CleverC2200/dsh-genui/issues/2). T2 owns renderer fixes and the browser runner, T3 owns model instructions, T4 owns CI, and T5 owns combined acceptance.

## Inputs and source

- [business-presentation.json](../fixtures/business-presentation.json) contains two fixed specs. `pagination` was recovered read-only on 2026-11-12 from mounted GenuiBlock props in a surviving isolated Electron window. It preserves that spec, including its action names. It is not a recovered original disk file. The old checkout, original screenshot and business-v2 files were missing. `stress` is a new synthetic companion for long text, numeric units and unknown status.
- [business-presentation-cases.json](../fixtures/business-presentation-cases.json) is the model acceptance list. Every prompt uses synthetic data. These runs do not establish production queries or production acceptance.

The cases classify component choice as `required`, `optional` or `short`. Status, inventory and ranking each have an explicit request and an implicit positive case. Their short controls ask a narrow question about the same subjects. A subject keyword alone does not require a component. Each case supplies its content and interaction criteria.

Record `render_ui` calls separately from inline `dsh-ui` output and actual rendering. Either path can satisfy a required case only when the component actually renders and meets the content criteria. Optional cases accept useful components or concise prose. Short cases require a direct answer without either UI path. Record model, session, evidence and the content/interaction result per case. Do not infer model triggering from fixed-spec browser passes.

## Browser entry point

Serve `/tests/browser/business-presentation.html` through the existing Vite setup from `scripts/check-interaction-state-browser.mjs`, including React deduplication and its standalone primitive-adapter alias. The fixture mounts the real GenuiBlock with standalone host theme tokens. It starts with `pagination`, width 960, host font 17.

The public fixture API is `window.genuiPresentation`:

```js
window.genuiPresentation.mountCase('pagination', { width: 360, hostFontSize: 22 })
window.genuiPresentation.mountCase('stress', { width: 960, hostFontSize: 17 })
window.genuiPresentation.mount(spec, { width: 360, hostFontSize: 14, reset: false })
window.genuiPresentation.events
window.genuiPresentation.provenance
```

`mountCase` accepts `pagination` and `stress`. `mount` accepts an existing GenuiSpec. Mounts flush synchronously; the runner should wait for fonts and layout before measurement or screenshots. Options default to width 960, host font 17, and reset true. Reset clears captured events and renderer state; reset false keeps both for interaction rerenders. Width is the outer host box, including 16px padding on each side, and is capped by the viewport. Set the browser viewport to the requested width. The host font sets `--dsh-content-font-size` and the inherited font size.

Actions append `{ action, payload }` to `events`; no network or business handler is connected. The recovered buttons must emit `fetch_next_page` and `show_loaded_rows`. The companion button emits `inspect_synthetic_rows`. Activating each button once must append exactly one matching event. Changing width/font or merely mounting must emit nothing. Use real pointer or keyboard input and inspect payloads without adding hidden field data or rewriting action contracts.

T2 adds `scripts/check-business-presentation-browser.mjs` using the existing Vite/CDP browser infrastructure. T4 invokes that runner in CI. T1 provides inputs and criteria; it does not claim the baseline renderer meets them.

## Fixed browser criteria

Run both specs for the full Cartesian matrix: viewport and host width 360/960, host font 14/17/22, device scale factor 1. Capture one screenshot per spec/matrix cell and a JSON result with the measured values, input identity, browser version and failing criterion. Keep browser evidence separate from real-model session evidence.

These bounds come from reading the mixed numeric/text content at the requested host sizes, not from copying current computed styles. Allow 1px geometry and 0.1px font rounding tolerance.

| Criterion | Pass condition |
| --- | --- |
| Content | All labels and full values remain in DOM and visible, including `2 / 100`, `partial`, `是（hasMore=true）`, `未完成`, the long value and `12,345.67 箱`. No ellipsis, line clamp or hidden overflowing value. |
| Numeric hierarchy | A numeric stat's main value is at least 1.3 times the host font and at most 2.1 times the host font, with a 22px minimum. The quantity is visibly stronger than its label. |
| Text hierarchy | A text stat value is at least `max(14px, hostFont × 0.85)` and at most `max(20px, hostFont × 1.25)`. This applies to `partial`, the mixed boolean text and the long status value. Text does not inherit the large numeric style. |
| Numeric suffix | The complete `箱` suffix is visible and at least `max(12px, hostFont × 0.75)`. Its font is no larger than the numeric main value. The value and suffix preserve their order and do not overlap. |
| Other reading text | Stat labels, deltas and action labels are at least `max(12px, hostFont × 0.75)`. At host font 22 they grow beyond the default small-text floor. |
| Containment | The host, card group and each stat have no horizontal content overflow beyond 1px. Visible text rectangles stay inside their cards; no overlap with labels, sibling values, suffixes or buttons. Tables may use their existing internal scroll region, but may not widen the page. |
| Group layout | Cards may reflow or wrap at 360. Cards sharing a visual row align their top and bottom edges within 1px, including the long-text card. At 960 a long value must not push another card outside its group. |
| Status meaning | `未完成`, `未知`, `待核对` and `partial` do not receive a success class, success token or green success indicator. No automatic success semantics for an unrecognized delta. The positive `+3.2%` control retains the renderer's positive convention. |
| Business boundary | The recovered page keeps its warning that 200 boxes cover only 2 of 100 orders; it must not show a full-order stockout rate or mark pagination complete. |
| Interactions | Each visible action works once through a real pointer or keyboard, preserves its action name and records one local event. Mounting emits none, and no business request runs. |

Measure visible DOM content and geometry through the renderer. Avoid exact CSS class names, copied token formulas or full-page snapshots as the only assertions. Screenshots support the behavior assertions and allow review of typography and wrapping. Fixed browser passes cover rendering and local event dispatch; actual host, model triggering and follow-up answers need the separate session cases.
