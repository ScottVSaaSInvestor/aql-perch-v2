// ============================================================
// GET /api/companies/[id]/runs
// ------------------------------------------------------------
// Return the full run history for a single company, newest first.
// Powers the per-company detail view in the dashboard.
// ============================================================

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const id = Number(req.query.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid company id' });
    }

    const { rows: companyRows } = await sql`
      SELECT * FROM companies WHERE id = ${id} LIMIT 1
    `;
    if (companyRows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { rows: runRows } = await sql`
      SELECT id, created_at,
             weighted_risk_score, weighted_readiness_score,
             quadrant, partner_posture, conviction, confidence_level,
             delta_narrative, risk_score_delta, readiness_score_delta,
             quadrant_changed, prior_run_id,
             searches_performed, pages_fetched, model
      FROM runs
      WHERE company_id = ${id}
      ORDER BY created_at DESC
    `;

    return res.status(200).json({
      ok: true,
      company: companyRows[0],
      runs: runRows
    });
  } catch (err) {
    console.error('[company runs GET] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch company runs', detail: err.message });
  }
}
