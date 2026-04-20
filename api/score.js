// ============================================================
// PERCH v2 — AQL Growth AI Risk & Readiness Diagnostic
// Vercel Serverless Function — Backend API
// ============================================================
//
// Key fixes over v1:
// 1. Uses content.find() to locate text block (NOT content[0]) — content[0]
//    is the thinking block when extended thinking is enabled, which caused
//    silent parse failures in v1.
// 2. Checks stop_reason === 'max_tokens' before parsing. Retries on truncation.
// 3. Logs full raw response to console for any parse failure (inspectable in
//    Vercel logs).
// 4. Robust multi-strategy JSON extraction as a final safety net.
//
// Anthropic model: Claude Sonnet 4 with web_search + web_fetch + extended thinking
// ============================================================

const RISK_FACTORS = [
  { id: 'R1', name: 'Competitive Window', weight: 18, description: 'How much time before AI fundamentally changes how deals in this vertical get won and lost. Measured in years: wide (3+), moderate (12-36 months), closing (<12 months).' },
  { id: 'R2', name: 'AI-Native Entrant Threat', weight: 16, description: 'Whether a well-funded ($15M+) AI-native startup is targeting the core workflow with a credible wedge and early traction.' },
  { id: 'R3', name: 'Incumbent AI Posture', weight: 15, description: 'How the company stands vs direct competitors on shipped AI features that customers actually use. Production shipping, not roadmap theater.' },
  { id: 'R4', name: 'Horizontal AI Encroachment', weight: 16, description: 'Whether the product value can be largely replicated by ChatGPT/Claude plus a thin UI. Substitution-resistance via state, compliance, SOR authority.' },
  { id: 'R5', name: 'Customer Switching Propensity', weight: 14, description: 'Practical difficulty and organizational cost to move from this product to an AI-enabled competitor. Measured in months of implementation.' },
  { id: 'R6', name: 'Regulatory Moat Durability', weight: 11, description: 'Hard certifications (SOC2, HIPAA, FedRAMP), mandated audit trails, compliance gates that take years for entrants to clear.' },
  { id: 'R7', name: 'Market Timing Risk', weight: 10, description: 'Whether AI investment matches where buyers actually are. Not too early (wasting capital), not too late (missing table stakes).' }
];

const READINESS_FACTORS = [
  { id: 'A1', name: 'Workflow Embeddedness', weight: 18, description: 'Does the software sit at the operational center of the customer business? Open all day, touched by every worker, generating real-world actions.' },
  { id: 'A2', name: 'Data Foundation & Quality', weight: 18, description: 'Multi-tenant cloud warehouse, unified schema, documented data dictionary, working CDC pipelines. Is the data in a shape AI can actually work with?' },
  { id: 'A3', name: 'Outcome-Labeled Data', weight: 14, description: 'Does the product capture proposal → correction → approval → outcome chains? Raw telemetry vs teachable dataset.' },
  { id: 'A4', name: 'Value Quantification', weight: 12, description: 'Can the company tell a customer in dollars exactly how much value the software delivers? ROI cases with baseline measurements.' },
  { id: 'A5', name: 'Pricing Model Flexibility', weight: 5, description: 'Ability to shift pricing from per-seat to outcome-tier. Is the commercial system flexible, or rigid?' },
  { id: 'A6', name: 'AI/ML Team Capability', weight: 12, description: 'Named builders with production shipping evidence. In-house applied AI, not outsourced.' },
  { id: 'A7', name: 'Architecture Readiness', weight: 10, description: 'Cloud-native, multi-tenant, scalable inference, RAG layer, observability, safe AI deployment discipline.' },
  { id: 'A8', name: 'Compounding Loop Potential', weight: 8, description: 'Is there at least one named workflow where usage → outcome labels → model improvement → better outcomes → more monetization actually connects as a closed loop?' },
  { id: 'A9', name: 'Leadership AI Clarity', weight: 3, description: 'Can the CEO connect AI to specific workflow, specific customer segment, specific economic result in one sentence? Lowest weight, but often the binding constraint.' }
];

function buildScoringPrompt(company, docCount) {
  const docsNote = docCount > 0
    ? `
============================================================
UPLOADED DOCUMENTS PROVIDED
============================================================

The analyst has uploaded ${docCount} document(s) above this prompt. These are PRIMARY SOURCES and should be your FIRST research step before web searches. Read them thoroughly. They likely contain:
- Private information not available on the public web
- AQL's existing thesis on this company
- CEO or leadership strategy documents
- Financial or operational detail
- Prior IC memos or diligence artifacts

Integrate evidence from these uploaded documents into your factor rationales, explicitly citing them (e.g. "Per the CEO strategy memo..." or "The Q3 ops review shows..."). Private document evidence is typically higher-signal than public web evidence — weight it accordingly.

`
    : '';

  return `You are PERCH — AQL Growth's AI Risk & Readiness diagnostic instrument. You produce investment-grade analysis that a partner will read BEFORE a term sheet decision.

Your job: perform a thorough, deep, evidence-based 16-factor analysis of the target company AND project a 12-month forward view. The output must be defensible to an IC and readable to an LP.${docsNote}

============================================================
CONVERGENCE LOGIC — THE FRAMEWORK IN ONE PAGE
============================================================

Three statements govern how the 16 factors compose into an investment diagnosis:

1. RISK SETS URGENCY. The 7 Risk factors measure the clock — how much time the company has before external forces materially impact its value. High Risk = low clock = must ship SOA capability fast. Low Risk = ample clock = can sequence SOA work deliberately.

2. READINESS SETS FEASIBLE SPEED. The 9 Readiness factors measure what the company can actually execute. High Readiness = the company can ship Pathway 2 in 90-day cycles. Low Readiness = the company's speed is capped by foundation gaps (data, architecture, team) that must be fixed before AI can ship safely.

3. ALL PATHS CONVERGE ON SOA MILESTONES. The destination is the same for every deal: the company becomes a System of Action. The SOR->SOA transition is where outcome-tier pricing, compounding loops, and exit multiple expansion live. The four quadrants are not different destinations — they are different sequencing disciplines for reaching the same destination.

The scoring job is therefore: DIAGNOSE WHETHER THIS COMPANY CAN REACH SOA MILESTONES INSIDE OUR HOLD, given the urgency (Risk) and feasible speed (Readiness) you measure. Every factor score contributes to that diagnosis.

============================================================
COMPANY TO ANALYZE
============================================================
Name: ${company.name}
Domain: ${company.domain}
Vertical: ${company.vertical}
Additional context from analyst: ${company.context || '(none provided - use public evidence and category reasoning)'}

============================================================
ANALYSIS PROCESS
============================================================

STEP 1: RESEARCH (use web_search AGGRESSIVELY, use web_fetch to read full pages)

Do 15-25 searches and fetch 5-8 full pages before scoring. If uploaded documents were provided, READ THEM FIRST.

Research dimensions:
A. Company primary evidence (4-6 searches + 2-3 fetches): product page, AI features, case studies
B. Competitive landscape (4-6 searches): named competitors, AI-native entrants, funding signals
C. Category disruption (2-3 searches): analyst reports, category trends
D. Customer voice (2 searches + 1 fetch): G2/Capterra reviews, complaints
E. Leadership (1-2 searches): CEO statements on AI strategy
F. Financial/regulatory (1-2 searches): funding, compliance certs

STEP 2: SCORE ALL 16 FACTORS with specific evidence citations.

STEP 3: PROJECT 12-MONTH TRAJECTORY based on current scores + category dynamics IF the Bridge executes as written.

STEP 4: IDENTIFY 3-4 THRESHOLD TRIGGERS — observable events that would force re-underwrite.

STEP 5: BUILD THE SOA MILESTONE MAP. Given urgency (Risk) and feasible speed (Readiness), sequence the concrete SOA milestones this company must hit.

============================================================
AQL QUADRANT FRAMEWORK (canonical from Value Creation Manifesto)
============================================================

EXECUTE (Low Threat + High Readiness) — Run the playbook deliberately. Quality-focused roadmap.
RACE MODE (High Threat + High Readiness) — Ship fast, competitive pressure is real.
BUILD MODE (Low Threat + Low Readiness) — Foundations first, then AI. Time is on your side. LEGITIMATE state, not a problem.
DANGER ZONE (High Threat + Low Readiness) — Evaluate thesis before proceeding.

Thresholds: Readiness > 50 = High. Risk > 50 = High Threat.

============================================================
RISK FACTORS (0-100, LOWER is better - less threat)
============================================================

${RISK_FACTORS.map(f => `${f.id} - ${f.name} (weight ${f.weight}%)
${f.description}`).join('\n\n')}

Bands: 0-30 Low threat. 31-50 Low-moderate. 51-70 Elevated. 71-100 Critical.

============================================================
READINESS FACTORS (0-100, HIGHER is better)
============================================================

${READINESS_FACTORS.map(f => `${f.id} - ${f.name} (weight ${f.weight}%)
${f.description}`).join('\n\n')}

Bands: 0-40 Early/weak. 41-50 Developing (legitimate BUILD MODE territory). 51-65 Moderate-strong EXECUTE. 66-79 Strong EXECUTE. 80+ Best-in-class.

============================================================
CALIBRATION ANCHORS - REAL AQL PORTFOLIO
============================================================

EXECUTE BENCHMARKS (Low Threat + High Readiness):

AxisCare (home care agency management, 3.2x MOIC realized):
  Risk: ~22 LOW THREAT — deep switching costs, substitution-resistant workflows
  Readiness: ~74 HIGH READY — multi-tenant, strong data foundation
  -> EXECUTE

Jane Software (healthcare practice management, 7.1x MOIC realized):
  Risk: ~42 LOW THREAT but closer to RACE MODE boundary — category facing real AI-native pressure, but substitution-resistant workflow embeddedness and deep switching costs keep it in EXECUTE
  Readiness: ~78 HIGH READY — multi-tenant scaled foundation, CEO-owned AI strategy
  -> EXECUTE (near RACE MODE boundary)

CommonSKU (promo products distribution, active):
  Risk: ~25 LOW THREAT — shipped AI leader in category
  Readiness: ~72 HIGH READY — five playbooks live, strong data foundation
  -> EXECUTE

Hauler Hero (waste hauling software, early hold):
  Risk: ~25 LOW THREAT — wide window, modern architecture
  Readiness: ~65 HIGH READY — strong workflow/architecture, team being built
  -> EXECUTE

Nymbl (EMR for Orthotics & Prosthetics practices, niche-protected vertical SOR):
  Risk: ~42 LOW THREAT — narrow specialty niche (~4K O&P practices US), heavy regulatory moat (HIPAA, Medicare/DMEPOS billing compliance), deep workflow embeddedness in clinical operations, horizontal AI substitution not credible for device fitting and insurance documentation workflows
  Readiness: ~70 HIGH READY — solid SaaS foundations, vertical workflow depth, domain expertise in O&P billing/compliance supports AI monetization
  -> EXECUTE (near RACE MODE boundary, monitor for category-specific AI pressure)

RACE MODE BENCHMARKS (High Threat + High Readiness):

Financial Cents (accounting practice management, active):
  Risk: ~55 HIGH THREAT (just across the boundary) — credible AI-native entrants targeting accounting practice management, horizontal AI encroachment risk is real (ChatGPT-style wrappers can replicate significant value), category-specific buyer pressure shifting toward AI-native expectations
  Readiness: ~55 HIGH READY but fighting uphill — solid SaaS fundamentals, shipped AI, decent data foundation, but resources stretched vs category pressure
  -> RACE MODE (near EXECUTE boundary, Bridge must emphasize Pathway 2 pace)

BUILD MODE BENCHMARKS (Low Threat + Low Readiness - legitimate):

Albi (restoration contractor, foundation build):
  Risk: ~30 LOW THREAT — strong regulatory-adjacent moat
  Readiness: ~45-48 LOW READY (below 50 threshold) — early-stage foundation build
  -> BUILD MODE (time to methodically build)

============================================================
SCORING DISCIPLINE
============================================================

1. EVERY score backed by specific evidence from web research. Name sources where possible.

2. CALIBRATE to portfolio benchmarks. Vertical SaaS with shipped AI + modern architecture + basic data foundation = 55-65 Readiness (EXECUTE), NOT 45.

3. Don't score Risk > 50 without SPECIFIC threat evidence: named funded entrant, competitor shipping materially ahead, analyst reports flagging disruption. Category uncertainty alone is NOT high threat.

4. BUILD MODE is legitimate when threat is low. Do not inflate scores to upgrade a BUILD MODE company.

5. Absence of public evidence != absence of capability. Use category reasoning. Note confidence appropriately.

6. CLOSE-CALL DETECTION: If either score is within 5 points of a quadrant boundary (45-55 on either axis), flag it.

7. CONFIDENCE LEVEL: Report overall confidence (High/Moderate/Low) based on evidence QUALITY, not comfort with conclusion.

============================================================
TRAJECTORY PROJECTION
============================================================

EXECUTE companies: readiness climbs 5-10 points as playbooks mature; risk stable or slowly rising.
RACE MODE: readiness climbs 10-15 points with aggressive execution; risk stays elevated or climbs.
BUILD MODE: readiness climbs 15-25 points over 12 months of foundation investment; risk climbs modestly.
DANGER ZONE: projection depends on thesis review outcome. Default is re-underwrite or exit.

Name SPECIFIC assumptions. Be honest about uncertainty.

============================================================
OUTPUT FORMAT — CRITICAL
============================================================

Respond with ONLY a single valid JSON object matching the structure below. No preamble, no commentary, no markdown fences. Start with { and end with }.

{
  "company_summary": "3-4 sentences: what they do, stage/scale, material recent events",
  "confidence_level": "High / Moderate / Low",
  "confidence_rationale": "1-2 sentences on evidence quality, gaps, ambiguity",
  "key_evidence": ["5-8 specific evidence bullets with source references"],
  "risk_scores": {
    "R1": {"score": 0-100, "rationale": "3-4 sentence evidence-backed reasoning"},
    "R2": {...}, "R3": {...}, "R4": {...}, "R5": {...}, "R6": {...}, "R7": {...}
  },
  "readiness_scores": {
    "A1": {"score": 0-100, "rationale": "3-4 sentence evidence-backed reasoning"},
    "A2": {...}, "A3": {...}, "A4": {...}, "A5": {...}, "A6": {...}, "A7": {...}, "A8": {...}, "A9": {...}
  },
  "close_call_flag": {
    "is_close_call": true/false,
    "axis": "risk / readiness / both / none",
    "explanation": "If close call, what the boundary is and what could tip it."
  },
  "twelve_month_view": {
    "current_posture": "EXECUTE / RACE MODE / BUILD MODE / DANGER ZONE",
    "current_t0_summary": "1-2 sentences on where they are today",
    "projected_t1_risk_score": 0-100,
    "projected_t1_readiness_score": 0-100,
    "projected_t1_posture": "EXECUTE / RACE MODE / BUILD MODE / DANGER ZONE",
    "trajectory_narrative": "3-4 sentences: projected 12-month arc, what moves, what the Bridge should focus on",
    "key_assumptions": ["Assumption 1", "Assumption 2", "Assumption 3"]
  },
  "threshold_triggers": [
    "Observable event + projected factor impact",
    "Another trigger",
    "Another trigger"
  ],
  "gap_to_target": [
    "Priority 1 gap + specific Bridge playbook + 90-day milestone",
    "Priority 2 gap + specific playbook",
    "Priority 3 gap if material"
  ],
  "soa_milestone_map": {
    "urgency_read": "1-2 sentences on what the Risk score means for the clock",
    "feasible_speed_read": "1-2 sentences on what the Readiness score means for execution pace",
    "arrival_confidence": "High / Moderate / Low",
    "arrival_confidence_rationale": "1-2 sentences on confidence the company reaches SOA milestones inside the hold",
    "milestones": [
      {"number": 1, "milestone": "Specific concrete SOA milestone", "target_month": 6, "feasibility_given_readiness": "ACHIEVABLE / AT RISK / BLOCKED", "urgency_pressure": "LOW / MODERATE / HIGH", "linked_factors": ["A1", "A6"]},
      {"number": 2, "milestone": "Specific concrete milestone", "target_month": 12, "feasibility_given_readiness": "ACHIEVABLE / AT RISK / BLOCKED", "urgency_pressure": "LOW / MODERATE / HIGH", "linked_factors": ["A2", "A3"]},
      {"number": 3, "milestone": "Specific concrete milestone", "target_month": 18, "feasibility_given_readiness": "ACHIEVABLE / AT RISK / BLOCKED", "urgency_pressure": "LOW / MODERATE / HIGH", "linked_factors": ["A4", "A5"]},
      {"number": 4, "milestone": "Specific concrete milestone", "target_month": 24, "feasibility_given_readiness": "ACHIEVABLE / AT RISK / BLOCKED", "urgency_pressure": "LOW / MODERATE / HIGH", "linked_factors": ["A8"]}
    ],
    "biggest_blocker": "Named factor or factors that must move for the SOA path to work"
  },
  "partner_posture": {
    "posture": "BUY / HOLD / INVEST MORE / SELL / DECLINE",
    "conviction": "High / Moderate / Low",
    "thesis": "one sharp sentence capturing the deal thesis",
    "biggest_upside_lever": "one sentence",
    "biggest_risk_to_monitor": "one sentence",
    "cadence_recommendation": "one sentence on review cadence given quadrant placement"
  }
}`;
}

// ============================================================
// JSON EXTRACTION — robust multi-strategy parser
// ============================================================
function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;

  // Strategy 1: Direct parse
  try {
    return { parsed: JSON.parse(text.trim()), strategy: 'direct' };
  } catch (e) { /* fall through */ }

  // Strategy 2: Strip markdown fences
  try {
    const clean = text
      .replace(/^[\s\S]*?```(?:json)?\s*/i, '')
      .replace(/\s*```[\s\S]*$/, '')
      .trim();
    return { parsed: JSON.parse(clean), strategy: 'fence-strip' };
  } catch (e) { /* fall through */ }

  // Strategy 3: First { to last } (greedy)
  try {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return {
        parsed: JSON.parse(text.substring(firstBrace, lastBrace + 1)),
        strategy: 'greedy-braces'
      };
    }
  } catch (e) { /* fall through */ }

  // Strategy 4: Regex for largest JSON-like object
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return { parsed: JSON.parse(match[0]), strategy: 'regex-match' };
    }
  } catch (e) { /* fall through */ }

  return null;
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfigured: ANTHROPIC_API_KEY environment variable not set.' });
  }

  const { name, domain, vertical, context, documents } = req.body || {};
  if (!name || !domain || !vertical) {
    return res.status(400).json({ error: 'Missing required fields: name, domain, vertical' });
  }

  const company = { name, domain, vertical, context: context || '' };
  const docs = Array.isArray(documents) ? documents : [];

  // Validate documents
  for (const d of docs) {
    if (!d.name || !d.type || !d.data) {
      return res.status(400).json({ error: 'Malformed document: missing name, type, or data' });
    }
    if (d.data.length > 8_000_000) {
      return res.status(400).json({ error: `Document "${d.name}" exceeds 6MB size limit` });
    }
  }

  try {
    const prompt = buildScoringPrompt(company, docs.length);

    // Build content blocks: documents first, then text prompt
    const contentBlocks = [];
    for (const d of docs) {
      if (d.type === 'application/pdf') {
        contentBlocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: d.data },
          title: d.name
        });
      } else {
        let textContent;
        try {
          textContent = Buffer.from(d.data, 'base64').toString('utf-8');
        } catch (e) {
          textContent = d.data;
        }
        contentBlocks.push({
          type: 'text',
          text: `=== UPLOADED DOCUMENT: ${d.name} ===\n\n${textContent}\n\n=== END DOCUMENT ===`
        });
      }
    }
    contentBlocks.push({ type: 'text', text: prompt });

    // ========== API CALL ==========
    const requestBody = {
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: 10000
      },
     tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 20 },
        { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 8 }
      ],
      messages: [{ role: 'user', content: contentBlocks }]
    };

    console.log(`[PERCH] Starting analysis: ${company.name} (${company.domain})`);
    console.log(`[PERCH] Documents attached: ${docs.length}`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-fetch-2025-09-10'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PERCH] Anthropic API error:', response.status, errorText);
      return res.status(502).json({
        error: `Anthropic API returned ${response.status}`,
        detail: errorText.substring(0, 500)
      });
    }

    const data = await response.json();

    // ========== STOP REASON CHECK (Genspark fix #2) ==========
    // If Claude ran out of tokens, the JSON will be truncated. Don't even try to parse.
    if (data.stop_reason === 'max_tokens') {
      console.error('[PERCH] Response truncated (stop_reason=max_tokens)');
      console.error('[PERCH] Usage:', JSON.stringify(data.usage));
      return res.status(500).json({
        error: 'Analysis response exceeded token budget. Try reducing research depth or removing documents.',
        stop_reason: data.stop_reason,
        usage: data.usage
      });
    }

    // ========== EXTRACT TEXT CONTENT (Genspark fix #1) ==========
    // Use find() to locate the text block. content[0] is the thinking block
    // when extended thinking is enabled — that was the root cause of v1 failures.
    const textBlock = data.content.find(b => b.type === 'text');
    const rawText = textBlock?.text ?? '';

    // Observability metrics
    const searchCount = data.content.filter(b =>
      b.type === 'server_tool_use' && b.name === 'web_search'
    ).length;
    const fetchCount = data.content.filter(b =>
      b.type === 'server_tool_use' && b.name === 'web_fetch'
    ).length;
    const hasThinking = data.content.some(b => b.type === 'thinking');

    console.log(`[PERCH] Searches: ${searchCount}, Fetches: ${fetchCount}, Thinking used: ${hasThinking}`);
    console.log(`[PERCH] Stop reason: ${data.stop_reason}, Text length: ${rawText.length}`);

    // ========== PARSE JSON ==========
    if (!rawText || rawText.length < 100) {
      console.error('[PERCH] Text block is empty or too short');
      console.error('[PERCH] Content blocks received:', data.content.map(b => b.type).join(', '));
      console.error('[PERCH] Raw text (first 500 chars):', rawText.substring(0, 500));
      return res.status(500).json({
        error: 'Anthropic response did not contain a usable text block',
        content_block_types: data.content.map(b => b.type),
        text_length: rawText.length,
        raw_preview: rawText.substring(0, 500)
      });
    }

    const extraction = extractJSON(rawText);
    if (!extraction) {
      // Full diagnostic logging — inspectable in Vercel logs
      console.error('[PERCH] JSON extraction failed. Full raw response:');
      console.error(rawText.substring(0, 4000));
      console.error('[PERCH] Response end (last 500 chars):');
      console.error(rawText.substring(Math.max(0, rawText.length - 500)));

      return res.status(500).json({
        error: 'Could not parse scoring response as JSON',
        raw_preview: rawText.substring(0, 2000),
        raw_end: rawText.substring(Math.max(0, rawText.length - 500)),
        response_length: rawText.length,
        stop_reason: data.stop_reason
      });
    }

    console.log(`[PERCH] JSON parsed successfully via: ${extraction.strategy}`);

    return res.status(200).json({
      ok: true,
      result: extraction.parsed,
      meta: {
        searches_performed: searchCount,
        pages_fetched: fetchCount,
        extended_thinking_used: hasThinking,
        parse_strategy: extraction.strategy,
        model: data.model,
        stop_reason: data.stop_reason,
        usage: {
          input_tokens: data.usage?.input_tokens || 0,
          output_tokens: data.usage?.output_tokens || 0
        }
      }
    });

  } catch (error) {
    console.error('[PERCH] Handler error:', error);
    return res.status(500).json({
      error: 'Screening failed',
      detail: error.message
    });
  }
}
