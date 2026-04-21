// ============================================================
// /api/runs
// ------------------------------------------------------------
// POST — save a completed PERCH run to the corpus
// GET  — list runs with dashboard filters
// ============================================================

import { sql } from '@vercel/postgres';
import {
  normalizeDomain,
  deriveQuadrant,
  computeWeightedRisk,
  computeWeightedReadiness,
  upsertCompany,
  fetchPriorRun,
  buildDeltaNarrative
} from '../_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'GET')  return handleGet(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

// ============================================================
// POST — save a completed PERCH run
// ============================================================
async function handlePost(req, res) {
  try {
    const { company, result, meta, documents } = req.body || {};

    if (!company || !company.name || !company.domain || !company.vertical) {
      return res.status(400).json({ error: 'Missing company fields' });
    }
    if (!result || !result.risk_scores || !result.readiness_scores) {
      return res.status(400).json({ error: 'Missing PERCH result payload' });
    }

    const companyRow = await upsertCompany({
      name: company.name,
      domain: company.domain,
      vertical: company.vertical
    });

    const weightedRisk = computeWeightedRisk(result.risk_scores);
    const weightedReadiness = computeWeightedReadiness(result.readiness_scores);
    const quadrant = deriveQuadrant(weightedRisk, weightedReadiness);

    const priorRun = await fetchPriorRun(companyRow.id);
    const delta = priorRun
      ? buildDeltaNarrative(priorRun, result, weightedRisk, weightedReadiness)
      : null;

    const normalizedDomain = normalizeDomain(company.domain);
    const { rows } = await sql`
      INSERT INTO runs (
        company_id, company_name, company_domain, company_vertical, company_context,
        weighted_risk_score, weighted_readiness_score, quadrant,
        partner_posture, conviction, confidence_level,
        model, searches_performed, pages_fetched, input_tokens, output_tokens,
        result_json, meta_json,
        prior_run_id, delta_narrative, risk_score_delta, readiness_score_delta, quadrant_changed
      )
      VALUES (
        ${companyRow.id}, ${company.name}, ${normalizedDomain}, ${company.vertical}, ${company.context || null},
        ${weightedRisk}, ${weightedReadiness}, ${quadrant},
        ${result.partner_posture?.posture || null},
        ${result.partner_posture?.conviction || null},
        ${result.confidence_level || null},
        ${meta?.model || null},
        ${meta?.searches_performed ?? null},
        ${meta?.pages_fetched ?? null},
        ${meta?.usage?.input_tokens ?? null},
        ${meta?.usage?.output_tokens ?? null},
        ${JSON.stringify(result)}::jsonb,
        ${meta ? JSON.stringify(meta) : null}::jsonb,
        ${priorRun ? priorRun.id : null},
        ${delta?.narrative || null},
        ${delta?.risk_delta ?? null},
        ${delta?.readiness_delta ?? null},
        ${delta?.quadrant_changed ?? false}
      )
      RETURNING id, created_at
    `;
    const runRow = rows[0];

    if (Array.isArray(documents) && documents.length > 0) {
      for (const d of documents) {
        if (d && d.name && d.type && typeof d.size === 'number') {
          await sql`
            INSERT INTO documents (run_id, name, type, size_bytes)
            VALUES (${runRow.id}, ${d.name}, ${d.type}, ${d.size})
          `;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      run_id: runRow.id,
      company_id: companyRow.id,
      is_re_score: !!priorRun,
      delta: delta || null
    });
  } catch (err) {
    console.error('[runs POST]', err);
    return res.status(500).json({ error: 'Failed to save run', detail: err.message });
  }
}

// ============================================================
// GET — list runs with filters
// ============================================================
async function handleGet(req, res) {
  try {
    const q = req.query || {};
    const filters = {
      quadrant:      q.quadrant || null,
      posture:       q.posture || null,
      min_risk:      q.min_risk != null ? Number(q.min_risk) : null,
      max_risk:      q.max_risk != null ? Number(q.max_risk) : null,
      min_readiness: q.min_readiness != null ? Number(q.min_readiness) : null,
      max_readiness: q.max_readiness != null ? Number(q.max_readiness) : null,
      company_id:    q.company_id != null ? Number(q.company_id) : null,
      since:         q.since || null,
      latest_only:   q.latest_only === 'true'
    };
    const limit  = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const offset = Math.max(Number(q.offset) || 0, 0);

    const whereParts = [];
    const params = [];
    if (filters.quadrant)      { params.push(filters.quadrant);      whereParts.push(`quadrant = $${params.length}`); }
    if (filters.posture)       { params.push(filters.posture);       whereParts.push(`partner_posture = $${params.length}`); }
    if (filters.min_risk != null) { params.push(filters.min_risk);   whereParts.push(`weighted_risk_score >= $${params.length}`); }
    if (filters.max_risk != null) { params.push(filters.max_risk);   whereParts.push(`weighted_risk_score <= $${params.length}`); }
    if (filters.min_readiness != null) { params.push(filters.min_readiness); whereParts.push(`weighted_readiness_score >= $${params.length}`); }
    if (filters.max_readiness != null) { params.push(filters.max_readiness); whereParts.push(`weighted_readiness_score <= $${params.length}`); }
    if (filters.company_id != null) { params.push(filters.company_id); whereParts.push(`company_id = $${params.length}`); }
    if (filters.since)         { params.push(filters.since);         whereParts.push(`created_at >= $${params.length}`); }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    let queryText;
    if (filters.latest_only) {
      queryText = `
        SELECT id, company_id, created_at,
               company_name, company_domain, company_vertical,
               weighted_risk_score, weighted_readiness_score,
               quadrant, partner_posture, conviction, confidence_level,
               delta_narrative, risk_score_delta, readiness_score_delta,
               quadrant_changed, prior_run_id
        FROM (
          SELECT DISTINCT ON (company_id) *
          FROM runs
          ${whereClause}
          ORDER BY company_id, created_at DESC
        ) latest
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
    } else {
      queryText = `
        SELECT id, company_id, created_at,
               company_name, company_domain, company_vertical,
               weighted_risk_score, weighted_readiness_score,
               quadrant, partner_posture, conviction, confidence_level,
               delta_narrative, risk_score_delta, readiness_score_delta,
               quadrant_changed, prior_run_id
        FROM runs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
    }
    params.push(limit, offset);

    const { rows } = await sql.query(queryText, params);

    const countParams = params.slice(0, params.length - 2);
    const countText = `SELECT COUNT(*)::int AS total FROM runs ${whereClause}`;
    const { rows: countRows } = await sql.query(countText, countParams);
    const total = countRows[0]?.total || 0;

    return res.status(200).json({
      ok: true,
      total,
      returned: rows.length,
      limit,
      offset,
      filters,
      runs: rows
    });
  } catch (err) {
    console.error('[runs GET]', err);
    return res.status(500).json({ error: 'Failed to list runs', detail: err.message });
  }
}
