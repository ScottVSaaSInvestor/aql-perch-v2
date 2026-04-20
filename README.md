# PERCH v2 — AQL Growth AI Risk & Readiness Diagnostic

**Stage 3 of Eagle Vision · Pre-Term-Sheet Deep Diligence · Partner Edition**

*From the eagle's perch.*

---

## What PERCH v2 is

PERCH is AQL Growth's investment-grade diagnostic instrument. Given a target company, PERCH performs live web research (15-25 searches, 5-8 page fetches), reads uploaded documents if provided, and produces a 16-factor scorecard that lands the company in one of four operating quadrants:

| Quadrant | Posture |
|---|---|
| **EXECUTE** (Low Threat · High Readiness) | Invest with conviction |
| **RACE MODE** (High Threat · High Readiness) | Invest with urgency |
| **BUILD MODE** (Low Threat · Low Readiness) | Invest with patience |
| **DANGER ZONE** (High Threat · Low Readiness) | Decline |

PERCH answers three questions:
1. Does this modern SOR have a lane?
2. For how long?
3. How ready is it to become a System of Action?

---

## What's new in v2 vs v1

### Bug fixes (the reason for the rebuild)

**Root cause of v1 failures:** When Anthropic's extended thinking is enabled, the API response `content` array arrives as `[thinking_block, text_block]`. v1 code used `content[0].text` to extract the output — which grabbed the thinking block (empty `.text`), so JSON parsing silently failed on every run.

**v2 fixes:**
- Uses `content.find(b => b.type === 'text')` to locate the text block correctly
- Checks `stop_reason === 'max_tokens'` before parsing — no more parsing truncated JSON
- Multi-strategy JSON extraction (direct → fence-strip → greedy-braces → regex) as a safety net
- Full diagnostic logging when parsing fails — raw response visible in Vercel logs

### Architectural improvements

- **Cleaner token budget:** `max_tokens: 16000` (was 48000), `thinking.budget_tokens: 10000` (was 20000), `max_uses: 20/8` for search/fetch (was 35/12). The old v1 limits were exhausting the model before the JSON output could be written.
- **Observability:** Every run logs `[PERCH]` prefixed messages with searches/fetches used, stop reason, text length, and parse strategy.
- **Cleaner error messages:** Users see actionable errors ("Analysis response exceeded token budget") instead of generic "Screening failed".
- **No interleaved thinking:** Removed `interleaved-thinking-2025-05-14` beta header that caused mid-response commentary between tool calls.

### What's preserved from v1

- All 16 factor definitions and weights
- Canonical portfolio calibration anchors (Jane 42/78, Nymbl 42/70 O&P EMR, Financial Cents 55/55 RACE MODE, AxisCare, CommonSKU, Hauler Hero EXECUTE, Albi BUILD MODE)
- v1.5 frontend UI (education section, answer key, document upload via mammoth.js, print CSS, SOA Milestone Map rendering)
- Three questions prose and eagle's perch tagline
- Eagle Vision 5-stage lifecycle framing

---

## Deployment

### Prerequisites
- GitHub account
- Vercel Pro account (needed for 800s function timeout)
- Anthropic API key

### One-time setup

1. Create a new GitHub repo named `aql-perch-v2`
2. Upload all files in this folder to the repo root (preserve folder structure: `api/` and `public/` folders intact)
3. Go to Vercel dashboard → Add New Project → Import from Git → select `aql-perch-v2`
4. Configure environment variable:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your Anthropic API key (starts with `sk-ant-...`)
5. Deploy

### Updating

Any commit to `main` branch auto-deploys via Vercel. To update a single file:
- Navigate to file on GitHub
- Click pencil icon to edit
- Paste new content
- Commit → Vercel auto-deploys in ~60 seconds

---

## Architecture

```
┌──────────────────┐      ┌─────────────────────┐      ┌───────────────────┐
│  Browser         │─────▶│  Vercel Serverless  │─────▶│  Anthropic API    │
│  public/         │      │  api/score.js       │      │  (Claude Sonnet 4 │
│  index.html      │      │                     │      │   + Web Search    │
│  + mammoth.js    │      │  Holds              │      │   + Web Fetch     │
│  (DOCX extract)  │◀─────│  ANTHROPIC_API_KEY  │◀─────│   + Ext Thinking) │
└──────────────────┘      └─────────────────────┘      └───────────────────┘
```

---

## Files

```
aql-perch-v2/
├── api/
│   └── score.js         Backend serverless function
├── public/
│   └── index.html       Frontend (self-contained, 72K)
├── package.json         Node config
├── vercel.json          Vercel config (maxDuration: 800s)
├── .gitignore           Prevents committing secrets
└── README.md            This file
```

---

## Troubleshooting

**"Could not parse scoring response as JSON"**
- Check Vercel logs (Deployments → click latest → Logs tab)
- Look for `[PERCH]` prefixed messages
- Logs will include raw response preview for diagnosis
- Most common cause in v1 was the `content[0]` bug (fixed in v2). If this happens in v2, it's a genuine Anthropic output issue to investigate.

**"Analysis response exceeded token budget"**
- Claude hit `max_tokens` before finishing the JSON
- Reduce research depth (edit `max_uses` in `api/score.js`)
- Or remove uploaded documents
- Or increase `max_tokens` (requires Vercel Pro for longer timeouts)

**"Anthropic API returned 401"**
- `ANTHROPIC_API_KEY` environment variable not set correctly in Vercel
- Go to Vercel → Project Settings → Environment Variables → verify

**Build/deploy succeeds but page is blank**
- Check browser console for JS errors
- Verify `public/index.html` uploaded correctly and is in the `public/` folder at repo root

---

## Costs

| Input | Cost per run |
|---|---|
| No documents, standard research depth | $1.50-3.00 |
| With 1-2 uploaded docs (~30 pages total) | $2.50-4.00 |
| With 4 documents full 6MB each | $4-6 |

Claude Sonnet 4 pricing: $3/M input tokens, $15/M output tokens (as of April 2026).

---

*AQL Growth · Eagle Vision · PERCH v2 · Partner Edition*
