# Tender

An any-chain crypto checkout. A buyer pays with whatever asset they already hold on any
of 31+ chains; the merchant is settled in one asset on Monad. No bridging, no network
switching, no gas token needed by either side.

Crypto checkout abandonment runs above 85%, and the named causes are network-selection
confusion, unclear payment timers, and missing QR codes. Tender deletes the first one
outright rather than mitigating it.

## Repository status

| Half | Location | State |
| --- | --- | --- |
| Web — marketing site, docs, dashboard, checkout | `frontend/` | built |
| API — invoices, settlement poller, webhooks | `backend/` (spec: `backend/BACKEND.md`) | in progress |

The web half is what is here today. It is written against the API contract documented on
the `/docs` page; the two are reconciled once the API lands.

## Stack

- **Next.js 15** (App Router) + TypeScript
- **Tailwind CSS v4** — tokens declared with `@theme` in `src/app/globals.css`, no JS config
- **Motion** (`motion/react`) for the scroll-driven sections
- Self-hosted fonts via `next/font/local`

## Getting started

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.

> **Note:** if `NODE_ENV=production` is set in your shell, `next dev` will fail.
> Either clear it, or use the production path: `npm run build && npm start`.

## Routes

| Route | Description |
| --- | --- |
| `/` | Landing page — hero, fee-scroll, comparison, chains, FAQ, CTA |
| `/docs` | API documentation: quickstart, endpoints, invoice states, webhooks |
| `/blog` | Article index |
| `/blog/[slug]` | Three prerendered posts |

All routes are statically generated at build time.

## Project layout

```
src/
├── app/
│   ├── page.tsx          composes the landing sections in order
│   ├── docs/             API documentation page
│   ├── blog/             index + [slug] posts
│   ├── globals.css       design tokens (@theme) and shared utilities
│   └── layout.tsx        fonts, nav, footer
├── components/
│   ├── nav.tsx  footer.tsx  button.tsx  icons.tsx
│   ├── media-slot.tsx    renders a placeholder until an image exists on disk
│   └── sections/         one file per landing-page section
└── lib/
    ├── copy.ts           ⭐ all landing-page text
    ├── docs.ts           all /docs content
    └── posts.ts          blog post bodies
```

**All copy lives in `src/lib/`.** Text changes never require touching JSX.

## Conventions

A few things that are load-bearing and easy to break:

- **Design tokens are CSS custom properties** declared in `@theme`
  (`--color-ink`, `--color-sand`, `--color-paper`, `--color-stone`, `--color-mute`,
  `--color-line`). Use `bg-ink`, `text-sand` etc. rather than raw hex values.
- **`.section-y` sets `padding-block` and is emitted after Tailwind's padding
  utilities**, so `pt-*` / `pb-*` on the same element silently lose to it. Use the
  `.section-y-flush-t` / `.section-y-tight-b` / `.section-y-tight-t` modifiers declared
  beside it in `globals.css`.
- **Links to a landing-page section must be root-relative** (`/#chains`, not `#chains`).
  A bare hash resolves against the current page, so it does nothing on `/docs` or `/blog`.
- **`overflow-x: hidden` belongs on `html`, not `body`** — on `body` it creates a scroll
  container and breaks the sticky fee-scroll section.
- **Sections rendering `MediaSlot` must stay server components.** It does a filesystem
  check, so marking such a file `"use client"` pulls `node:fs` into the browser bundle.

## Status

The site is complete and responsive from 375px up, with no horizontal overflow at
375 / 414 / 768 / 1024 / 1440.

Outstanding: the five fee-scroll illustrations (`public/img/beat-1.svg` … `beat-5.svg`)
are still numbered placeholders.

The `/docs` content is written against the intended API contract. Endpoint paths and
response shapes are reconciled with the API once it lands.
