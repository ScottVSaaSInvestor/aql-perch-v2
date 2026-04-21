// ============================================================
// GET /api/companies
// ------------------------------------------------------------
// List all companies PERCH has analyzed, with aggregate stats
// and the latest run's placement attached.
//
// Query params (optional):
//   vertical      — filter by vertical
//   quadrant      — filter by latest run's quadrant
//   limit         — default 200, max 500
//   offset        — default 0
//
// Returns: { ok: true, total, companies: [...] }
// ============================================================

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const q = req.query || {};
    const limit  = Math.min(Math.max(Number(q.limit) || 200, 1), 500);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const vertical = q.vertical || null;
    const quadrant = q.quadrant || null;

    // Company list with latest-run columns via DISTINCT ON
    const whereParts = [];
    const params = [];
    if (vertical) { params.push(vertical); whereParts.push(`c.vertical = $${params.length}`); }
    if (quadrant) { params.push(quadrant); whereParts.push(`latest.quadrant = $${params.length}`); }
    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const queryText = `
      WITH latest_runs AS (
        SELECT DISTINCT ON (company_id)
          company_id, id AS latest_run_id, created_at AS last_run_at,
          weighted_risk_score, weighted_readiness_score, quadrant,
          partner_posture, conviction, risk_score_delta, readiness_score_delta,
          quadrant_changed
        FROM runs
        ORDER BY company_id, created_at DESC
      )
      SELECT c.id, c.name, c.domain, c.vertical,
             c.first_scored_at, c.last_scored_at, c.run_count,
             latest.latest_run_id, latest.last_run_at,
             latest.weighted_risk_score, latest.weighted_readiness_score,
             latest.quadrant, latest.partner_posture, latest.conviction,
             latest.risk_score_delta, latest.readiness_score_delta,
             latest.quadrant_changed
      FROM companies c
      LEFT JOIN latest_runs latest ON latest.company_id = c.id
      ${whereClause}
      ORDER BY c.last_scored_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const { rows } = await sql.query(queryText, params);

    // Total
    const countParams = params.slice(0, params.length - 2);
    const countText = `
      WITH latest_runs AS (
        SELECT DISTINCT ON (company_id) company_id, quadrant
        FROM runs
        ORDER BY company_id, created_at DESC
      )
      SELECT COUNT(*)::int AS total
      FROM companies c
      LEFT JOIN latest_runs latest ON latest.company_id = c.id
      ${whereClause}
    `;
    const { rows: countRows } = await sql.query(countText, countParams);
    const total = countRows[0]?.total || 0;

    // Portfolio distribution stats (unfiltered — always helpful in dashboard header)
    const { rows: statRows } = await sql`
      WITH latest_runs AS (
        SELECT DISTINCT ON (company_id) company_id, quadrant
        FROM runs
        ORDER BY company_id, created_at DESC
      )
      SELECT quadrant, COUNT(*)::int AS count
      FROM latest_runs
      GROUP BY quadrant
    `;
    const distribution = {
      EXECUTE: 0, 'RACE MODE': 0, 'BUILD MODE': 0, 'DANGER ZONE': 0
    };
    for (const row of statRows) distribution[row.quadrant] = row.count;

    return res.status(200).json({
      ok: true,
      total,
      returned: rows.length,
      limit,
      offset,
      distribution,
      companies: rows
    });
  } catch (err) {
    console.error('[companies GET] Error:', err);
    return res.status(500).json({ error: 'Failed to list companies', detail: err.message });
  }
}
