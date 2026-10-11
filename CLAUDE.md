# Inventory API
REST API for products, stock levels and movements. Foundation for a Nepal shop ledger.

## Stack
Node 22 · Express · TypeScript (strict) · Zod validation · Helmet · Vitest. Hosted on Render.

## Commands
- Dev: `npm run dev` · Build: `npm run build` · Start: `npm start`
- Test: `npm test` · Lint: `npm run lint && npm run typecheck`

## Architecture
- `src/app.ts` builds the app and takes its dependencies as options, so tests construct it directly.
- Storage is in memory behind a narrow interface: swap it for a real database without touching routes.

## API rules
- Validate every request body and query with Zod. Never trust client input.
- One error shape everywhere: RFC 9457 problem details (`type`, `title`, `status`, `detail`).
- Every response carries `X-Request-Id`; rate limit responses carry `RateLimit-*` headers.
- Writes require the `API_KEY` header. Reads stay public.

## Testing rules
- Every endpoint needs tests for the happy path, a validation failure and an auth failure.
- Run lint, typecheck and tests before finishing.

## Security and git
- Never commit secrets, keystores, .env files or email addresses.
- Keep the Content-Security-Policy strict; add a host to connect-src only when a feature needs it.
- CORS allows only our own origins. Keep Helmet on.
- `main` is protected: branch, open a PR, merge when CI is green. One issue per PR, under ~300 lines.

## Done when
Lint clean, tests pass, CI green, PR opened with a three line summary.
