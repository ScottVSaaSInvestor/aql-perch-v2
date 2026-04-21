// ============================================================
// api/_db.js — shared database helpers for PERCH corpus
// ============================================================
// This file is imported by the runs/companies API routes.
// Files prefixed with _ are treated by Vercel as shared modules,
// not as routes (no endpoint is exposed at /api/_db).
// ============================================================

import { sql } from '@vercel/postgres';

// ------------------------------------------------------------
// Domain normalization — the key we use for deduping companies.
// "https://www.AxisCare.com/" -> "axiscare.com"
// ------------------------------------------------------------
export function normalizeDomain(input) {
  if (!input) return '';
  let d = String(input).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.replace(/\/.*$/, '');       // strip path
  d = d.replace(/\?.*$/, '');       // strip query
  d = d.replace(/:\d+$/, '');       // strip port
  return d;
}

// ------------------------------------------------------------
// Derive the quadrant name from risk + readiness scores.
// Must match the thresholds in index.html / report.html exactly.
// ------------------------------------------------------------
export function deriveQuadrant(riskScore, readinessScore) {
  const lowThreat = riskScore <= 50;
  const highReady = readinessScore > 50;
  if (lowThreat && highReady) return 'EXECUTE';
  if (!lowThreat && highReady) return 'RACE MODE';
  if (lowThreat && !highReady) return 'BUILD MODE';
  return 'DANGER ZONE';
}

// ------------------------------------------------------------
// Weighted score calculators — duplicated here so backend can
// compute scores from result_json without trusting client math.
// ------------------------------------------------------------
const RISK_WEIGHTS = { R1: 18, R2: 16, R3: 15, R4: 16, R5: 14, R6: 11, R7: 10 };
const READINESS_WEIGHTS = { A1: 18, A2: 18, A3: 14, A4: 12, A5: 5, A6: 12, A7: 10, A8: 8, A9: 3 };

export function computeWeightedRisk(risk_scores) {
  let total = 0;
  for (const [id, weight] of Object.entries(RISK_WEIGHTS)) {
    if (risk_scores[id] && typeof risk_scores[id].score === 'number') {
      total += (risk_scores[id].score * weight) / 100;
    }
  }
  return Math.round(total * 100) / 100;
}

export function computeWeightedReadiness(readiness_scores) {
  let total = 0;
  for (const [id, weight] of Object.entries(READINESS_WEIGHTS)) {
    if (readiness_scores[id] && typeof readiness_scores[id].score === 'number') {
      total += (readiness_scores[id].score * weight) / 100;
    }
  }
  return Math.round(total * 100) / 100;
}

// ------------------------------------------------------------
// Upsert a company by normalized domain.
// Returns the row (existing or newly created).
// ------------------------------------------------------------
export async function upsertCompany({ name, domain, vertical }) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) throw new Error('Domain required for company upsert');

  const { rows } = await sql`
    INSERT INTO companies (name, domain, vertical)
    VALUES (${name}, ${normalizedDomain}, ${vertical})
    ON CONFLICT (domain) DO UPDATE
      SET name = EXCLUDED.name,
          vertical = EXCLUDED.vertical
    RETURNING *
  `;
  return rows[0];
}

// ------------------------------------------------------------
// Find the most recent prior run for a company.
// Used to build the delta narrative when re-scoring.
// ------------------------------------------------------------
export async function fetchPriorRun(companyId) {
  const { rows } = await sql`
    SELECT * FROM runs
    WHERE company_id = ${companyId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

// ------------------------------------------------------------
// Generate a plain-English delta narrative between two runs.
// Mechanical (not AI-generated) so it's fast, deterministic,
// and cites specific factor changes.
// ------------------------------------------------------------
export function buildDeltaNarrative(priorRun, currentResult, currentRisk, currentReadiness) {
  if (!priorRun) return null;

  const priorRisk = Number(priorRun.weighted_risk_score);
  const priorReadiness = Number(priorRun.weighted_readiness_score);
  const priorQuadrant = priorRun.quadrant;
  const priorDate = new Date(priorRun.created_at);

  const riskDelta = currentRisk - priorRisk;
  const readinessDelta = currentReadiness - priorReadiness;
  const currentQuadrant = deriveQuadrant(currentRisk, currentReadiness);
  const quadrantChanged = priorQuadrant !== currentQuadrant;

  const daysAgo = Math.max(1, Math.round((Date.now() - priorDate.getTime()) / (1000 * 60 * 60 * 24)));
  const timeAgo = daysAgo === 1 ? 'yesterday'
                : daysAgo < 14   ? `${daysAgo} days ago`
                : daysAgo < 60   ? `${Math.round(daysAgo / 7)} weeks ago`
                : `${Math.round(daysAgo / 30)} months ago`;

  // Find factors that moved most — prior run's result_json has the same structure
  const priorResult = priorRun.result_json || {};
  const factorMoves = [];

  // Risk factors
  for (const id of Object.keys(RISK_WEIGHTS)) {
    const curr = currentResult.risk_scores?.[id]?.score;
    const prev = priorResult.risk_scores?.[id]?.score;
    if (typeof curr === 'number' && typeof prev === 'number' && Math.abs(curr - prev) >= 5) {
      factorMoves.push({ id, side: 'Risk', delta: curr - prev, curr, prev });
    }
  }
  // Readiness factors
  for (const id of Object.keys(READINESS_WEIGHTS)) {
    const curr = currentResult.readiness_scores?.[id]?.score;
    const prev = priorResult.readiness_scores?.[id]?.score;
    if (typeof curr === 'number' && typeof prev === 'number' && Math.abs(curr - prev) >= 5) {
      factorMoves.push({ id, side: 'Readiness', delta: curr - prev, curr, prev });
    }
  }
  // Sort by absolute delta, biggest first
  factorMoves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = factorMoves.slice(0, 3);

  const parts = [];
  parts.push(`Last scored ${timeAgo}.`);

  // Quadrant change is the headline
  if (quadrantChanged) {
    parts.push(`Placement shifted from ${priorQuadrant} to ${currentQuadrant}.`);
  } else {
    parts.push(`Placement held in ${currentQuadrant}.`);
  }

  // Score movement
  const riskDir = riskDelta > 0.5 ? 'climbed' : riskDelta < -0.5 ? 'eased' : 'held';
  const readyDir = readinessDelta > 0.5 ? 'climbed' : readinessDelta < -0.5 ? 'eased' : 'held';

  if (Math.abs(riskDelta) >= 0.5 || Math.abs(readinessDelta) >= 0.5) {
    parts.push(
      `Risk ${riskDir}${Math.abs(riskDelta) >= 0.5 ? ` ${riskDelta > 0 ? '+' : ''}${riskDelta.toFixed(1)}` : ''} (to ${currentRisk.toFixed(1)}); ` +
      `Readiness ${readyDir}${Math.abs(readinessDelta) >= 0.5 ? ` ${readinessDelta > 0 ? '+' : ''}${readinessDelta.toFixed(1)}` : ''} (to ${currentReadiness.toFixed(1)}).`
    );
  } else {
    parts.push(`Both weighted scores essentially unchanged.`);
  }

  // Factor movement
  if (top.length > 0) {
    const bits = top.map(f => {
      const sign = f.delta > 0 ? '+' : '';
      const direction = (f.side === 'Risk' && f.delta > 0) || (f.side === 'Readiness' && f.delta < 0)
        ? 'worsened'
        : 'improved';
      return `${f.id} (${f.side}) ${direction}: ${f.prev} → ${f.curr} (${sign}${f.delta})`;
    });
    parts.push(`Biggest factor moves — ${bits.join('; ')}.`);
  } else {
    parts.push(`No individual factor shifted by 5+ points.`);
  }

  return {
    narrative: parts.join(' '),
    risk_delta: Math.round(riskDelta * 100) / 100,
    readiness_delta: Math.round(readinessDelta * 100) / 100,
    quadrant_changed: quadrantChanged
  };
}

// ------------------------------------------------------------
// Safe JSON parse
// ------------------------------------------------------------
export function safeJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}
