# Front-end Development

You are an expert in TypeScript, Angular, and scalable web application development. You write maintainable, performant,
and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking.
- Prefer type inference when the type is obvious.
- Avoid the `any` type; use `unknown` when type is uncertain.
  - If there is no better alternative for `any`, you must explain why with a comment.
- Refrain from casting and use strict typing instead.
- Use access modifiers for all members.
- Use the most restrictive access modifier possible.
- Sort access modifiers in the following order: `public`, `protected`, `private`
- Properties are located at the top of the class.

## Angular Best Practices

- Always use standalone components over NgModules.
- Standalone is the default in Angular; omitting `standalone: true` is preferred, but explicitly setting it is acceptable.
- Implement lazy loading for feature routes.
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead.
- Use `NgOptimizedImage` for content images (e.g. photos, illustrations). Small decorative images such as logos and icons do not require `NgOptimizedImage`.
- Always use `pipe(takeUntilDestroyed(this.destroyRef))` when subscribing to observables.
- Reactive form controls are called using `form.controls.[control]` instead of `form.get([control])`.
- Do not call methods or functions inside the Angular render cycle (template expressions).

## Components

- Keep components small and focused on a single responsibility.
- Use `input()` and `output()` functions instead of decorators.
- Members created with `input()`, `output()`, and `model()` are part of the component/directive API and must be `public`.
- Prefix all signal-valued properties from `signal()`, `computed()`, and `input()` with `$`.
- Use `computed()` for derived state.
- Use dedicated `.html` template files instead of inline component templates.
- Prefer Reactive forms instead of Template-driven ones.
- Do NOT use `ngClass`, use `class` bindings instead.
- Do NOT use `ngStyle`, use `style` bindings instead.
- Reusable components are placed in the `shared/components` folder.

## File naming conventions

- Components use `[component-name].component.[ts|html|less]`.
- Services use `[service-name].service.ts`
- Directives use `[directive-name].directive.ts`
- Pipes use `[pipe-name].pipe.ts`
- Models use `[model-name].model.ts`
- Request models use `[request-name].request.ts`
- Response models use `[response-name].response.ts`
- Types use `[type-name].type.ts`
- Enums use `[enum-name].enum.ts`
- Interfaces use `[interface-name].interface.ts`
- Guards use `[guard-name].guard.ts`

## State Management

- Use signals for the local component state.
- Use `computed()` for derived state.
- Keep state transformations pure and predictable.
- Do NOT use `mutate` on signals, use `update` or `set` instead.

## Templates

- Keep templates simple and avoid complex logic.
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`.
- Use the async pipe to handle observables.

## Services

- Design services around a single responsibility.
- Use the `providedIn: 'root'` option for singleton services.
- Prefer the `inject()` function over constructor parameter injection.

## Project structure

The application uses the following top-level folder structure inside `src/app/`:

- `core/` — application-wide singletons: config, layout, providers (interceptors, telemetry).
- `features/` — feature modules. Each feature has its own sub-folder containing page components and feature-specific components.
- `shared/` — reusable building blocks shared across features: components, directives, and utilities.

### Async state: `TResult<T, TError>`

Use the `TResult` pattern (from `@app/core/results`) to represent the loading/success/error lifecycle of async
operations:

- `useResultState<T>()` — creates an idle result state.
- `useLoadingResultState<T>()` — creates an initial loading state.
- `withLoadingResultState` — RxJS operator that maps an observable into a `TResult` stream.
