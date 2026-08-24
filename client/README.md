# Client

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.7.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Live tracking configuration

Live tracking uses Metered Realtime Messaging as an encrypted, managed relay. No application server
or TURN server is required. The free plan has hard limits and does not create usage charges.

1. Create a free account at [Metered](https://dashboard.metered.ca/signup).
2. Open **Realtime Messaging → Keys → Create key**.
3. Choose a publishable `pk_live_...` key.
4. Put the publishable key in `public/live-tracking-config.json`:

```json
{
  "meteredApiKey": "pk_live_your_key_here"
}
```

The current Metered dashboard may create publishable keys without editable channel or origin fields.
The configured key has been verified for `subscribe`, `publish`, message delivery, and `presence` on
`jetlag-live-*` channels. Never put a Metered secret key in this repository.

Session codes contain a random channel ID and a locally generated AES-256 key. Player names and
locations are AES-GCM encrypted before publication, so Metered only relays ciphertext.

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
