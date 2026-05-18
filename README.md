# Mocha Builder v3

AI-powered app builder. Describe any app in plain English — built live using Claude.

## What is new in v3 (vs v2)
- System prompt moved server-side only (your IP is protected, never in browser)
- Robust SSE stream parser (handles split network chunks, no dropped HTML)
- Context window truncation (only last 2 turns sent, prevents 20k+ token blowouts)
- 55-second API timeout with friendly error message
- Model name via env variable (update model without redeploying)
- iframe error boundary with blank-render detection
- Open in new tab button
- Smart download filename generated from your prompt
- Try an example button always visible after first build
- Mobile responsive layout (stacked panels on phones)
- Setup screen if API key is missing or wrong
- Character counter on prompt input
- OG meta tags for social sharing
- robots.txt (noindex until you are ready to go public)

---

## Deploy to Vercel

1. Push this folder to a GitHub repo
2. Go to vercel.com, New Project, import your repo
3. Settings, Environment Variables, add these:

   ANTHROPIC_API_KEY    = your key from console.anthropic.com   [required]
   CLAUDE_MODEL         = claude-sonnet-4-20250514               [optional]
   RATE_LIMIT_MAX       = 15                                     [optional]
   NEXT_PUBLIC_SITE_URL = https://yourapp.vercel.app            [optional]

4. Deploy

---

## Run locally

cp .env.example .env.local
# Edit .env.local and add your ANTHROPIC_API_KEY
npm install
npm run dev
# Open http://localhost:3000

---

## Environment variables reference

ANTHROPIC_API_KEY      Required. Get from console.anthropic.com
CLAUDE_MODEL           Optional. Default: claude-sonnet-4-20250514
RATE_LIMIT_MAX         Optional. Builds per hour per IP. Default: 15
NEXT_PUBLIC_SITE_URL   Optional. Used in OG meta tags for social sharing

---

## Before going public checklist

- [ ] Add og-image.png to /public (1200x630px) for social share previews
- [ ] Remove or edit /public/robots.txt to allow indexing
- [ ] Change <meta name="robots" content="noindex"> in pages/_app.js
- [ ] Set NEXT_PUBLIC_SITE_URL in Vercel env vars
- [ ] Consider upgrading rate limiter to Upstash Redis (see Phase 2 notes)
- [ ] Add Vercel Analytics (one line in _app.js)
- [ ] Add error tracking via Sentry free tier

---

## Phase 2 upgrades (next steps after this deploys)

1. Upstash Redis rate limiter (replaces in-memory, survives deploys)
2. Publish button with shareable URL (Vercel Blob)
3. Screenshot-to-app (upload image, get working app)
4. Auth + saved projects (Clerk + Supabase)
5. Vercel Analytics + PostHog
6. Sentry error tracking
7. Smart model routing (Haiku for simple, Sonnet for complex)

---

## Project structure

mocha-builder/
  pages/
    api/
      generate.js   Server-side proxy. Holds API key, system prompt, rate limiter, SSE parser.
    _app.js         OG tags, global meta, CSS import.
    index.js        Full UI. Chat, preview, history, device toggle, mobile layout.
  public/
    robots.txt      Blocks indexing until you are ready.
    og-image.png    Add your own (1200x630px).
  styles/
    globals.css     Base reset and body styles.
  .env.example      Copy to .env.local for local dev.
  next.config.js
  package.json
