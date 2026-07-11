# JetLag Map Repository Guide

This file applies to the entire repository. The application is a client-only Angular map tool inspired by travel games. There is no backend in this repository.

When working under `client/`, also read and follow [`client/AGENTS.md`](client/AGENTS.md). If instructions conflict, the more specific file takes precedence.

## Repository Layout

```text
.
├── .github/workflows/deploy-pages.yml  # GitHub Pages deployment
├── AGENTS.md                           # Repository-wide guidance
└── client/                             # Angular application
    ├── AGENTS.md                       # Angular and TypeScript conventions
    ├── angular.json
    ├── package.json
    ├── public/                         # Static assets and country geometry
    └── src/
        ├── app/
        │   ├── app.config.ts
        │   ├── app.routes.ts
        │   └── features/world-map/
        ├── index.html
        └── styles.less                 # Global tokens, overlays, and Leaflet styles
```

The application currently has one route and one primary feature: `features/world-map`.

## Toolchain

- Angular 21 with standalone components
- TypeScript in strict mode
- Signals for application and component state
- Vitest through Angular's unit-test builder
- LESS for styling
- NG-Zorro for controls, menus, cards, and dialogs
- Leaflet for map rendering and interaction
- GeoJSON and `polygon-clipping` for playable-area geometry
- Local storage and URL hashes for persistence and sharing
- GitHub Actions and GitHub Pages for deployment
- Node.js 22 in CI
- npm with the committed `client/package-lock.json`

Do not introduce a backend, database, authentication system, or server-side share service unless explicitly requested. Features should remain client-side by default.

## Commands

Run commands from `client/` unless noted otherwise.

```bash
npm ci
npm start
npm test -- --watch=false
npm run build
npm run build -- --base-href /jetlag-map/
```

Useful focused test command:

```bash
npm test -- --watch=false --include="src/app/features/world-map/pages/world-map-page/world-map-page.component.spec.ts"
```

From the repository root, equivalent commands can use `npm --prefix client`.

Before considering application work complete:

1. Run the most relevant focused tests while iterating.
2. Run `npm test -- --watch=false` for changes affecting shared state, geometry, rendering, or layout.
3. Run `npm run build` for production compilation.
4. For deployment-sensitive changes, also run `npm run build -- --base-href /jetlag-map/`.
5. Run `git diff --check` to catch whitespace errors.

The build currently reports known CommonJS optimization warnings for Leaflet and `polygon-clipping`. Do not treat those existing warnings as failures, but do not add new build warnings without justification.

## Architecture

### Page Composition

`WorldMapPageComponent` owns the page-level interaction flow:

- header and country selection
- desktop question rail and mobile bottom sheet
- visible question picker and map context menu
- right-click and long-press handling
- area-drawing workflow
- share action
- location toggle
- coordination between state services and the renderer

Keep page logic focused on orchestration. Put reusable state transformations in services and reusable geometry in utilities.

### State Services

`QuestionsService` owns all question state. It is responsible for:

- creating radar, thermometer, and area questions
- assigning stable IDs and colors
- updating question settings and marker positions
- locking, collapsing, renaming, and deleting questions
- validating restored or shared state
- persisting questions to local storage

`WorldMapStateService` owns selected-country state and share snapshots.

`CountryBoundaryService` owns country metadata, broad world geometry, detailed country geometry, and geometry caching.

`UserLocationService` wraps browser geolocation. It must stop watchers when disabled or when the page is destroyed.

`WorldMapRendererService` is the Leaflet boundary. Components should not create independent Leaflet layers when the renderer can own them.

### Question Models

The supported question types are:

- `radar`: circular inside/outside constraint
- `thermometer`: warmer/colder half-plane constraint
- `area`: user-drawn polygon with inside/outside constraint

`GameQuestion` is the discriminated union. Every new question type must be integrated in all relevant locations:

1. model and discriminator
2. creation and ID allocation
3. persistence validation
4. default title behavior
5. sidebar card dispatch
6. renderer dispatch
7. playable-area calculation
8. question bounds
9. sharing and restoration tests

Do not add a type to only the UI or only the renderer.

## Geometry Invariants

Geometry correctness is central to the application.

- Domain points and Leaflet use `{ lat, lng }`.
- GeoJSON positions use `[lng, lat]`.
- GeoJSON polygon rings must be closed. Persisted area vertices should remain open and should not duplicate the first point at the end.
- A completed area requires at least three valid vertices.
- Validate finite coordinates and legal latitude/longitude ranges before restoring state.
- Keep expensive clipping work out of pointer-move handlers. Update lightweight Leaflet shapes while dragging and recompute masks after drag completion.
- Preserve question order when applying constraints. The playable area is reduced sequentially by each active question.
- Inside constraints intersect the current playable area.
- Outside constraints subtract from the current playable area.
- Thermometer constraints intersect with the selected warmer/colder half-plane.
- Handle empty geometry results without throwing.

The active/playable zone must remain visually unfilled. Question boundaries and markers may use their assigned colors, but question polygons must not stack translucent color over the active zone. Excluded geography is represented by the neutral mask.

When changing geometry helpers, add focused tests in `geometry.util.spec.ts` or an appropriate utility spec. Include coordinate-order, ring-closure, degenerate input, and clipping behavior where relevant.

## Leaflet Rendering Rules

- Keep country layers, question layers, and user-location layers separate.
- Question rerenders must not remove or flicker the user-location marker.
- Remove or reuse old layers before adding replacements.
- Respect `question.isLocked` when configuring draggable markers.
- Marker drag callbacks must identify the edited point: radar center, thermometer start/end, or area vertex index.
- Keep the map usable without a selected country.
- Update bounds logic whenever a new geometry type is introduced.
- Preserve OpenStreetMap attribution.
- Styles for Leaflet-generated DOM belong in `client/src/styles.less`, because generated marker elements are outside component style encapsulation.
- Ensure map controls and overlays account for mobile safe-area insets.

## Persistence And Sharing

The application is intentionally client-only.

- Questions and selected country persist in local storage.
- Share links encode a versioned JSON snapshot in a URL-safe hash.
- Share encoding must support Unicode question titles.
- Treat URL content and local-storage content as untrusted input.
- Validate the entire snapshot before applying it.
- A valid shared snapshot takes precedence over existing local state once.
- After successful import, consume the `state` hash with `history.replaceState` so subsequent local edits survive refresh.
- Invalid share hashes should be ignored without deleting valid local data.
- Imported state should be persisted locally before normal editing continues.
- Bump the share-state version only for incompatible formats. Additive question support can remain on the current version when old links still validate.

Do not place secrets, personal location, or cached map data in share URLs.

## UI And Visual Language

The established visual direction is a **Passport Field Kit**:

- warm paper surfaces
- passport green structural elements
- signal red for primary/destructive emphasis
- customs green for selected and successful states
- serif display typography with condensed utility labels
- restrained notebook lines, stamps, borders, and field-note details

Preserve this visual language. Avoid reverting to generic blue Ant Design styling or introducing unrelated gradients, glass cards, and dashboard patterns.

Shared visual tokens are defined in `client/src/styles.less`. Reuse semantic variables such as:

- `--paper`, `--paper-light`, and `--paper-deep`
- `--paper-border` and `--paper-border-strong`
- `--ink` and `--ink-muted`
- `--passport-green`, `--customs-green`, and `--signal-red`
- `--focus` and `--shadow-float`

Do not duplicate token hex values throughout component styles when a semantic variable exists.

### Responsive Behavior

- Desktop uses a persistent, independently scrollable question rail.
- Tablet widths reduce the rail without making the map unusably narrow.
- Mobile uses a draggable bottom sheet so the map remains visible.
- The sheet must retain tap-to-toggle behavior as an accessible alternative to dragging.
- Mobile floating actions should remain compact and must not dominate the map.
- Respect `env(safe-area-inset-bottom)` for bottom controls.
- Do not rely on hover for essential actions.
- Recheck layout at narrow phones, landscape phones, tablets, and 200% browser zoom.

### Overlays And Dialogs

NG-Zorro menus, dropdowns, modals, and Leaflet elements may render outside component encapsulation. Style them globally and scope selectors as narrowly as possible.

Confirmation dialogs use the same paper, ink, customs-green, and signal-red system. They intentionally hide the close `X`; Cancel is the explicit non-destructive dismissal action.

## Accessibility

Accessibility is a product requirement, not optional polish.

- Keep interactive touch targets near 44px on mobile.
- Provide visible `:focus-visible` treatment.
- Use native buttons for actions.
- Use `fieldset` and `legend` for grouped answer controls.
- Add accessible names to icon-only controls.
- Expose collapse state with `aria-expanded` and lock state with `aria-pressed` or equivalent text.
- Announce asynchronous feedback such as drawing progress, copy success, and location errors where appropriate.
- Do not identify questions by color alone; retain type letters, labels, marker shapes, or line patterns.
- Honor `prefers-reduced-motion` for pulses, smooth scrolling, and sheet transitions.
- Hidden or collapsed mobile-sheet content must not remain confusingly available to assistive technology.
- Preserve keyboard access to scrollable question lists.
- Context menus and sheets must remain dismissible with Escape where applicable.

Map interactions are inherently pointer-heavy. Whenever practical, provide a visible button, form control, or card action as an alternative to a map-only gesture.

## Styling Ownership

- Global tokens, NG-Zorro overlays, Leaflet-generated elements, and application-wide overrides: `client/src/styles.less`
- Page layout and page-owned responsive behavior: `world-map-page.component.less`
- Shared question-card shell: `question-card.component.less`
- Type-specific controls: the corresponding radar, thermometer, or area card stylesheet

Avoid leaving the same selector implemented in both page and child-component styles. Prefer the narrowest owner that can style the element correctly.

The production build enforces component-style budgets. If a legitimate component redesign exceeds the warning threshold, first remove duplication or move truly global styles to `styles.less`. Change budget limits only when the resulting ownership is still appropriate.

## Angular And TypeScript Conventions

Follow `client/AGENTS.md` in addition to these repository-specific rules.

Important local expectations:

- Keep strict typing; do not use `any` in application code.
- Prefer type guards over assertions.
- Prefix signal-valued members with `$`.
- Use `computed()` for derived state.
- Use `set()` and `update()`, never signal mutation.
- Use native Angular control flow: `@if`, `@for`, and `@switch`.
- Do not call calculation methods from templates. Event handlers are fine.
- Use dedicated template and LESS files.
- Keep subscriptions lifecycle-safe.
- Preserve standalone components.
- Follow existing code conventions when touching older components that still use decorator inputs or FormsModule; do not perform unrelated migrations in feature work.

## Tests

Tests live beside the code they cover and run with Vitest.

Add or update tests for:

- state restoration and local persistence
- share-link round trips and hash consumption
- question creation and type validation
- geometry conversion and clipping
- drawing lifecycle and area closure
- geolocation watcher cleanup and error handling
- visible UI affordances and critical accessibility attributes

Do not rely only on snapshots for map behavior. Assert state, generated geometry, callback arguments, or visible controls directly.

Some page tests mock simplified country geometry and may log a known fallback-geometry warning while still passing. A new uncaught exception, timeout, or console error is not acceptable.

## GitHub Pages

The production site is deployed from `main` by `.github/workflows/deploy-pages.yml`.

- The site base path is `/jetlag-map/`.
- The uploaded artifact is `client/dist/client/browser`.
- Static assets must resolve under the configured Angular base href.
- Do not hard-code root-relative application asset URLs unless they intentionally include `/jetlag-map/`.
- Prefer relative asset URLs such as `favicon.svg` so local development and Pages both work.
- The workflow uses Node.js 22 and `npm ci`.

Any push to `main` triggers deployment. Validate a Pages-base build before changing routing, asset paths, service workers, or public files.

## Working Safely

- Keep changes minimal and focused on the requested behavior.
- Do not revert unrelated working-tree changes.
- Do not delete persisted-data compatibility without an explicit migration decision.
- Do not change storage keys casually; existing users may have saved state.
- Do not remove share-format validation.
- Do not commit generated `dist/` output.
- Do not add secrets or tokens to the repository.
- Do not commit or push unless explicitly requested.
- When changing map rendering, test both with and without a selected country.
- When changing layout, test both desktop and mobile interaction paths.

## Definition Of Done

A change is complete when:

- requested behavior works end to end
- existing radar, thermometer, and area workflows still work
- local persistence and share links are not regressed
- desktop and mobile layouts remain usable
- keyboard and touch paths remain available where relevant
- focused tests pass
- the full suite passes for cross-cutting changes
- the production build passes
- the GitHub Pages base-path build passes for deployment-sensitive changes
- no unrelated files or generated artifacts were modified
