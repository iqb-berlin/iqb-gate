# Rules

These are the rules of studio-lite's `rules.md`, adapted to a gateway and its libraries. Where a
rule of studio-lite does not fit here, the adaptation says what takes its place; what is not
listed (TypeORM, GitHub pull requests, board and tickets) does not apply.

## Workflow

### Before the Work: A Plan
- **Rule**: Every change starts with a plan, agreed with the person you are working for before
  anything is changed. Work it out in Claude Code's plan mode (Shift+Tab).
- **Rule**: The plan states decisions, not a list of options:
  - **what is asked for**;
  - **the cause, with evidence**: reproduced or measured, not assumed;
  - **the scope**;
  - **the tests**, including the test that fails without the change;
  - **the places at risk**:
    - the public API of a package (`public-api.ts`, `index.ts`);
    - the wire protocol the gateway and the browsers share (`@iqb/gate-protocol`: headers, status
      codes, `code` values);
    - the schema of `gate.yaml` (the parser is strict: an unknown key stops the gateway);
    - the audit file of an installation that is updated;
    - the applications that consume the packages (studio-lite installs them from local tarballs
      until they are published).

### Before the Commit: A Review
- **Rule**: Finish the change and verify it (`npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`, `npm run build:examples`), but do not commit yet. Run `/code-review` first; once
  the change is committed, name the scope (`/code-review <from>..HEAD`).
- **Rule**: After the review, check `git status`: review agents can leave files of their own.

### Local Only
- **Rule**: This repository has no remote. Do not add one, push, create a GitHub repository, or
  publish to npm or Docker Hub, unless asked to in so many words.

## The Packages

| Package | Kind | Tests |
|---|---|---|
| `packages/protocol` | constants, types and rules gateway and browser share; ES modules and CommonJS | vitest, `test/` |
| `packages/oidc` | OIDC token check, Node | vitest, `test/` |
| `packages/gateway` | Fastify reverse proxy, Node 24, Docker image | vitest, `test/`, flow specs `*-flow.spec.ts` |
| `packages/nest` | NestJS module and guard | vitest, `test/` |
| `packages/angular` | Angular library `@iqb/gate-angular` | jest, `*.spec.ts` beside the file |
| `examples/` | demo app, demo API, Keycloak | none (see *Examples*) |

## TypeScript (all packages)

### Type Safety: Avoid `any`
- **Rule**: Do NOT use `any`, `// @ts-ignore` or `// @ts-nocheck` (enforced by ESLint).
- **Solution**:
  - Use the types of `@iqb/gate-protocol`.
  - Use structural typing where only a part of a big type is read. For example,
    `detectSoftwareRenderer` asks for the three members of a WebGL context it reads, not for an
    `HTMLCanvasElement`.
  - Use `unknown` with type guards for what clients send.
- **Rule**: No `as unknown as` in source. In tests, where a stub stands in for a class, use
  `createMock<T>()` instead: `@golevelup/ts-jest` in `packages/angular`, `@golevelup/ts-vitest` in
  `packages/nest`.
  - Where its types refuse a value (an Observable as a return), create the mock first and set the
    value with `mockReturnValue`.
  - The gateway's tests use real instances, mostly a real gateway in front of a stub application,
    and need no mocks. Two of its specs still read a private field through a cast
    (`rate-limit.spec.ts`, `proof-of-work.spec.ts`); do not add more, observe through the public
    interface instead.

### Avoid Loops in Favor of Array Iterations
- **Rule**: No `for`, `for...of`, `for...in`, `while` or `do...while` (enforced by ESLint, more
  strictly than in studio-lite). Use `forEach`, `map`, `filter`, `some`, `every`, `reduce`; for
  steps that have to wait for each other, `reduce` over a promise.

### Line Length
- **Rule**: At most 120 characters (`@stylistic/max-len`). A call that does not fit puts **each**
  argument on its own line (`@stylistic/function-call-argument-newline: consistent`).

### Responsibility: Work That Is Not the Class's Job
- **Rule**: A class or module holds the work its name promises. A body that answers a different
  question becomes a function or class of its own beside it, with its own spec. Examples here:
  - the migration of old audit files lives in `audit/audit-schema.ts`, not in `AuditLog`;
  - HTML escaping lives in `html.ts`, not in the pages that use it.
- **Marks**: the same as in studio-lite. A method that uses no `this` is flagged by ESLint
  (`class-methods-use-this`, for `packages/*/src`).
- **Where it goes**:
  - **Angular library:** a function without dependencies goes to `src/lib/utils/`, one with
    injection or state into a service.
  - **Gateway:** a module of its own beside the class (`request-path.ts`, `timeouts.ts`); a whole
    area gets its folder (`audit/`, `session/`, `page-gate/`).
  - **A rule two packages must answer alike:** in `@iqb/gate-protocol` if the browser needs it (it
    has no dependencies and runs in both, e.g. `usernameOf`, `rolesOf`), otherwise in
    `@iqb/gate-oidc` (e.g. `bearerToken`, used by the gateway and the NestJS guard).

### Routes and Logic (the gateway's "Controllers and Services")
- **Rule**: Route modules and pre-handlers stay thin: `*-routes.ts`, `gatePreHandler`. They take
  the request, ask a class (`WriteGate`, `ReadGate`, `AuditLog`, `PersonVerification`) and answer.
  The decisions live in those classes and in plain functions (`checkedRequest`, `decidePage`).

### Storage: SQLite
- **Rule**: The audit log uses `node:sqlite` with prepared statements and `?` placeholders. A
  schema change goes into `audit/audit-schema.ts`, together with taking over an older file, so an
  update never loses entries.

## Texts

Studio-lite's i18n rule ("every text through `de.json`") becomes this:

- **Angular library:** every text a person reads comes from `GateTexts`, which an application
  overrides (`IQB_GATE_TEXTS`, `GateTextsOverride`; studio-lite takes them from its `de.json`). No
  text is written into a template.
- **The gateway's own pages:** their texts stand in one object per page, never scattered through
  the markup.
  - The interstitial and the denied page (`page-gate/page-texts.ts`) are seen by every person, so
    an installation can replace their texts in `pageGate.texts`.
  - The audit page is for administrators only; its German texts are not configurable.
- **Not texts for people:** the JSON `message` fields of the gateway's answers are API vocabulary
  in English; the library shows its own texts instead.
- **Anything a client sent** (paths, claims, configured texts) goes into a page only as text:
  `escapeHtml`, `jsonForScriptBlock`, or `textContent` in the page's script.

## Angular (packages/angular, examples/demo)

### Performance: Template Bindings
- **Rule**: No function calls, getters, array methods or object/array literals in template
  bindings. Reading a signal (`failed()`) is allowed; a value worked out for the template is a
  `computed` or a pure pipe.

### State: Signals
- **Rule**: New state is held in signals (`signal`, `computed`, `toSignal`), handed out read-only.
  Events and HTTP requests stay observables.

### Subscription Management
- **Rule**: A component's subscriptions end with it: `ngUnsubscribe` with `takeUntil`, or
  `takeUntilDestroyed()`, both are fine.
- **Exception**: a root service that subscribes to an observable that completes by itself
  (`afterClosed()`, a logoff request).

### Dialog Results: Only the Confirming Button Confirms
- **Rule**: Act on a dialog's result only when it is what its confirming button returns. A dialog
  closed by Esc, a click beside it or navigation returns `undefined`; for the challenge dialog that
  means "not verified".

### Modern Angular
- **Rule**: `@if`, `@for`, `@switch`; no `*ngIf`, `*ngFor`, `$any()`.
- **Rule**: No `NoopAnimationsModule`, `BrowserAnimationsModule` or `HttpClientTestingModule`
  (enforced by ESLint); use `provideHttpClient()` and `provideHttpClientTesting()`.

### Component Structure
- **Rule**: Every component of the library lives in `src/lib/components/<name>/` with four files:
  `.component.ts`, `.html`, `.scss`, `.spec.ts`. A second spec for a separate concern is allowed
  (`gate-verification-dialog-loading.component.spec.ts`).
- **Rule**: Splitting a component follows studio-lite's order: child component, then directive,
  then a base class without a selector.

### CSS
- **Rule**: In component SCSS, use classes, not element or attribute selectors.
- **Exception**: the inline CSS of the gateway's standalone pages (interstitial, audit page),
  where no component library can change the markup underneath.

## Tests

### Unit Testing Policy
- **Rule**: Every class and every module with logic has its own spec. Every public member is
  tested. Every fix comes with a test that fails without it.
- **Adaptation**:
  - Some gateway modules are covered by the flow specs (`*-flow.spec.ts`, `gateway.spec.ts`), which
    run a real gateway against a stub application, and have no spec of their own:
    - routes and assembly: `*-routes.ts`, `challenge-route.ts`, `gate-pre-handler.ts`, `main.ts`,
      `healthcheck.ts`;
    - session and audit plumbing: `session/gate-session.ts`, `session/gate-assessment.ts`,
      `audit/record-checked-request.ts`;
    - the page gate's pages and script: `page-gate/interstitial.ts`, through
      `page-gate-flow.spec.ts`.

    A change to one of them is tested there, by a flow test that fails without it.
  - In the Angular library, `oidc/session-memory.ts` is covered through the login guard's spec.
  - The NestJS guard is tested with a real `FakeProvider` and real tokens (`@iqb/gate-oidc/testing`),
    which is stronger than mocking the verifier.

### Asynchronous Tests
- **Rule**: Control time instead of waiting for it: `vi.useFakeTimers()` / `jest.useFakeTimers()`
  with `advanceTimersByTimeAsync`.
- **Adaptation**:
  - `fakeAsync` needs zone.js and cannot run in the zoneless tests; fake timers take its place.
  - Real time is allowed only where fake timers cannot drive what is tested:
    - real sockets that have to time out (the gateway's timeout tests);
    - `vi.waitFor` on audit entries, which the gateway writes after the answer is sent;
    - the one zoneless render in `gate-verification-dialog-loading.component.spec.ts`, which waits a
      task for the widget to load.

## Examples

`examples/` shows how the packages are used. It follows the TypeScript, template and signal rules
and is linted, but it is exempt from texts, component structure and specs.
