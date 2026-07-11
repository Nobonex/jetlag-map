# JetLag Map Client Guide

This file applies to everything under `client/`. Read the repository-wide [`../AGENTS.md`](../AGENTS.md) first. This guide adds Angular, TypeScript, template, and styling conventions specific to the client.

The client is a browser-only Angular application. Do not add server APIs, SSR requirements, authentication, or backend persistence unless explicitly requested.

## Local Commands

Run commands from `client/`.

```bash
npm ci
npm start
npm test -- --watch=false
npm run build
npm run build -- --base-href /jetlag-map/
```

Use focused Vitest runs while iterating:

```bash
npm test -- --watch=false --include="src/app/features/world-map/pages/world-map-page/world-map-page.component.spec.ts"
npm test -- --watch=false --include="src/app/features/world-map/utils/geometry.util.spec.ts"
```

Do not commit `dist/`, Angular cache output, coverage output, or generated dependency files other than the intentional `package-lock.json`.

## Client Structure

```text
src/
├── app/
│   ├── app.component.*
│   ├── app.config.ts
│   ├── app.routes.ts
│   └── features/world-map/
│       ├── components/
│       ├── constants/
│       ├── models/
│       ├── pages/
│       ├── services/
│       └── utils/
├── index.html
├── main.ts
└── styles.less
```

Keep feature-specific code under `features/world-map/`. Introduce `core/` or `shared/` only when there is a concrete cross-feature need; do not create empty architectural layers in anticipation of future features.

## TypeScript

- Keep strict type checking enabled.
- Do not use `any` in application code. Parse untrusted values as `unknown` and narrow them with type guards.
- Prefer inference when the type is obvious and explicit types at public boundaries.
- Use discriminated unions for question-specific behavior.
- Prefer type guards to assertions. Use assertions only when a framework boundary cannot express the runtime guarantee.
- Validate finite numbers and legal coordinate ranges at persistence and URL boundaries.
- Use `import type` for type-only imports.
- Add access modifiers to new class members and choose the narrowest practical visibility.
- Keep class properties together near the top of the class, followed by lifecycle methods, event handlers, and private helpers.
- Use `readonly` for dependencies and values that are not reassigned.
- Avoid non-null assertions except for framework-required inputs where Angular guarantees assignment.
- Keep helpers pure unless they intentionally update service or component state.
- Do not add compatibility branches without a concrete persisted-data or browser requirement.

## Angular Components

- Preserve standalone components; do not introduce NgModules.
- Keep page components focused on orchestration and feature components focused on presentation and local interaction.
- Use dedicated `.html` and `.less` files instead of inline templates and styles.
- Use `ChangeDetectionStrategy.OnPush`.
- Prefer `inject()` for new service dependencies.
- Prefer signal-based `input()` and `output()` APIs for new components when they fit the surrounding code.
- Existing components use decorator inputs, outputs, and view queries. Do not migrate them as unrelated cleanup during feature work.
- Do not use `@HostBinding` or `@HostListener`; use the component `host` object.
- Use `NgOptimizedImage` for meaningful content images. Small decorative assets such as the favicon-based logo do not require it.
- Keep browser and Leaflet objects out of reusable presentation components.
- Clean up timers, media-query listeners, geolocation watchers, map instances, and subscriptions during destruction.
- Use `takeUntilDestroyed()` for observable subscriptions.

## Signals And State

- Prefix members created by `signal()`, `computed()`, `input()`, or exposed signal aliases with `$`.
- Use `computed()` for derived values rather than manually synchronizing duplicate state.
- Use `set()` and `update()`; never mutate signal-held arrays or objects in place.
- Keep durable question state in `QuestionsService`, selected-country/share state in `WorldMapStateService`, and geolocation state in `UserLocationService`.
- Component signals should represent transient UI state such as menu visibility, sheet position, drawing feedback, or temporary labels.
- Effects should coordinate imperative boundaries such as Leaflet. Avoid effects for state that can be expressed as a computed signal.
- Ensure effects do not accidentally recreate expensive geometry during pointer movement.

## Templates

- Use native control flow: `@if`, `@for`, and `@switch`.
- Always provide a stable tracking expression for `@for`; question lists track by question ID.
- Signal reads in templates are expected. Do not call arbitrary calculation or allocation methods during rendering.
- Event-handler calls are allowed.
- Use property, class, attribute, and style bindings instead of `ngClass` and `ngStyle`.
- Keep complex narrowing and transformation logic in TypeScript, not template expressions.
- Use native buttons for actions and preserve their `type="button"`.
- Give icon-only controls an accessible name.
- Use `fieldset` and `legend` for answer groups.
- Connect disclosure controls with `aria-expanded` and `aria-controls`.
- Use `aria-pressed` or clear equivalent text for toggle state.
- Do not leave visually hidden mobile-sheet content confusingly interactive. Keep `aria-hidden`, focusability, and sheet state synchronized.
- Use `aria-live` sparingly for meaningful asynchronous feedback.

## Forms And Controls

- Prefer reactive forms for new multi-field forms or forms requiring validation.
- Existing compact question controls use `FormsModule` and `ngModel`; preserve that pattern when making focused edits.
- Keep draft and applied state behavior explicit. Radar currently supports draft settings before Apply; do not silently change its semantics.
- Clamp or reject invalid numeric values in the owning service, not only in the input widget.
- Disabled controls must still have understandable labels and visible state.

## Services

- Use `providedIn: 'root'` for application-wide singleton services.
- Give each service one clear responsibility.
- Keep persistence reads and writes guarded against unavailable or blocked storage.
- Treat local storage, URL hashes, GeoJSON files, and browser geolocation callbacks as boundary data.
- Do not let components write directly to question storage.
- Keep Leaflet layer creation, replacement, and cleanup in `WorldMapRendererService`.
- Keep reusable geometry conversion and clipping in utility files rather than services or components.

## Leaflet And Geometry

Follow the geometry and rendering invariants in the root guide. In client code specifically:

- Convert `{ lat, lng }` to GeoJSON `[lng, lat]` deliberately.
- Keep persisted area vertices open; close rings only while building GeoJSON polygons.
- Use lightweight Leaflet shape updates during drag and persist/recompute clipping on drag end.
- Keep country, question, and user-location layers independent.
- Keep the active zone unfilled. Only excluded geography receives the neutral mask.
- Preserve marker drag behavior when questions are unlocked and disable it when locked.
- Add bounds support whenever a new rendered geometry is introduced.
- Do not remove OpenStreetMap attribution.
- Avoid adding a mapping plugin when the behavior can be implemented clearly with the existing Leaflet API.

## LESS And Visual Design

Preserve the Passport Field Kit visual system defined in `src/styles.less`.

- Use semantic CSS variables instead of repeating colors.
- Keep paper, ink, passport green, customs green, and signal red roles consistent.
- Use serif display typography for headings and condensed utility typography for labels.
- Keep decorative notebook lines, stamps, and borders restrained.
- Do not reintroduce generic Ant Design blue as a primary visual language.
- Do not add glassmorphism, unrelated gradients, or dashboard-style cards.
- Maintain visible focus indicators with adequate contrast.
- Keep mobile touch targets close to 44px without making floating map controls dominate the viewport.
- Account for `env(safe-area-inset-bottom)` on bottom sheets and floating controls.
- Honor `prefers-reduced-motion` for pulses, smooth movement, and sheet transitions.

### Style Ownership

- `src/styles.less`: design tokens, NG-Zorro overlays, Leaflet-generated DOM, global focus rules, and application-wide third-party overrides
- `world-map-page.component.less`: page composition, header, map controls, question picker, drawing banner, and responsive bottom sheet
- `question-card.component.less`: shared card shell and card actions
- Type-specific component LESS: only controls unique to radar, thermometer, or area questions

NG-Zorro overlays are appended outside component encapsulation. Confirmation modal and dropdown styling therefore belongs in `src/styles.less` and must use narrowly scoped selectors.

Leaflet markers are also generated outside Angular component encapsulation. Their classes belong in `src/styles.less`.

Avoid duplicating the same selector across page and child styles. Before raising component-style budgets, remove obsolete declarations or move genuinely global third-party styling to `src/styles.less`.

## Responsive Interaction

- Desktop keeps a persistent, independently scrollable question rail.
- Tablet layouts may narrow the rail but must preserve useful map width.
- Mobile uses a draggable bottom sheet with tap-to-toggle fallback.
- The collapsed sheet must leave the map and compact Add/Menu controls usable.
- Pointer dragging must use pointer capture and avoid triggering the click fallback after an actual drag.
- Recalculate Leaflet size after meaningful sheet or layout transitions.
- Keep right-click and long-press shortcuts, but retain the visible Add action as the discoverable path.
- Test narrow portrait phones, landscape phones, tablets, desktop, and 200% zoom for layout changes.

## Accessibility

- Keyboard and touch behavior are required, not optional polish.
- Use semantic elements before ARIA.
- Keep question-list scrolling keyboard accessible.
- Do not communicate question identity or state through color alone.
- Maintain type letters, labels, marker letters/numbers, and line styles.
- Confirmation dialogs intentionally use Cancel instead of a close `X`.
- Context menus, sheets, and drawing states must remain dismissible.
- Ensure focus is visible over both paper surfaces and map content.
- Avoid reducing opacity so far that locked or disabled content becomes unreadable.

## Testing

- Keep tests beside the code they cover.
- Use Vitest APIs and Angular TestBed.
- Prefer state and behavior assertions over snapshots.
- Mock browser APIs such as `fetch`, geolocation, clipboard, history, and media queries at their boundaries.
- Restore changed globals after each test.
- Test valid and invalid persistence input.
- Test Unicode share titles and one-time share-hash consumption.
- Test coordinate order and ring closure for geometry helpers.
- Test watcher and listener cleanup.
- Add visible-control and critical ARIA assertions for interaction changes.

The page test suite may print a known fallback-geometry warning from its simplified fixture. Do not introduce new unhandled errors, rejected promises, timeouts, or console exceptions.

## Deployment

GitHub Pages serves the application at `/jetlag-map/`.

- Use relative static asset URLs such as `favicon.svg`.
- Validate deployment-sensitive changes with `npm run build -- --base-href /jetlag-map/`.
- The expected artifact directory is `dist/client/browser` from within `client/`.
- Do not hard-code development-only origins or absolute localhost URLs.
- Share links must continue to work when the application is hosted beneath the repository base path.

## Completion Checklist

Before finishing client work:

1. Run focused tests for the changed behavior.
2. Run the full suite for shared state, renderer, geometry, or broad UI changes.
3. Run a production build.
4. Run a Pages-base build for routing, asset, public-file, or deployment changes.
5. Run `git diff --check`.
6. Confirm no `dist/` output or unrelated files were added.
