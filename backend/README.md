# Tender API

The backend half of Tender. The full spec is [BACKEND.md](BACKEND.md); this file is how to run it.

## Run it

Needs Node 20+ and Docker.

```bash
cd backend
cp .env.example .env        # then set AURORA_API_KEY (https://studio.aurora.dev)
npm install
npm run setup               # starts Postgres (:5434) + Redis (:6379), applies migrations
npm run dev                 # API: http://localhost:4000 — Swagger UI at /docs
npm run dev:worker          # worker, in a second terminal
```

Create a merchant (prints its API key once — it goes in the frontend's `TENDER_API_KEY`):

```bash
npm run merchant:create -- --name "Acme" --email ops@acme.com --settlement 0xYourMonadAddress --verified
```

`--verified` attests that you control the settlement address. Use it only for an address you own.

## Scripts

| Script | What it does |
|---|---|
| `npm run setup` | One-time (and after pulling new migrations): containers up, migrations applied, client generated |
| `npm run dev` | API with reload. **Swagger UI: http://localhost:4000/docs** |
| `npm run dev:worker` | Worker with reload: poller, webhook delivery, minimum measurement |
| `npm run worker` | Compiled worker (after `npm run build`) |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run typecheck` | Types, **including the contract check against the frontend** |
| `npm test` | Unit + integration tests. Needs `npm run db:up`; uses its own `tender_test` database and a fake Aurora — no network |
| `npm run merchant:create -- …` | Create a merchant and print its API key once |
| `npm run aurora:smoke -- <0x monad address>` | Live Aurora check: lists Monad assets, mints one address per chain family. Moves no money. |
| `npm run db:up` / `db:down` / `db:migrate` | Local Postgres + Redis, migrations |

## Layout

```
contract/            zod schemas for the wire contract
  contract.check.ts  compile-time proof they match frontend/src/lib/api/types.ts
prisma/              schema + migrations
src/
  aurora/            the ONLY code that calls Aurora
  routes/            HTTP only: validate → call a service → respond
  services/          business logic
  workers/           poller, webhooks, expiry, recovery
  lib/               config-free helpers: money, ids, crypto, errors, logger
scripts/             one-off operational scripts
test/                vitest
```

## The contract check

The wire contract lives in `frontend/src/lib/api/types.ts`. `contract/contract.check.ts` asserts that every
schema in `contract/schemas.ts` has exactly the same fields and types. If either side renames or retypes a
field alone, `npm run typecheck` fails. Fix drift by agreeing the change with the frontend owner — not by
editing the check.
