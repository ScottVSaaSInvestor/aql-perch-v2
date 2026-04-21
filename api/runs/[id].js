// ============================================================
// GET /api/runs/[id]
// ------------------------------------------------------------
// Fetch a single run by id. Returns the full result_json + meta_json
// so the frontend can replay the run in the IC report view.
//
// Also returns the prior_run (if any) so the delta narrative can
// be displayed on the dashboard detail view.
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
      return res.status(400).json({ error: 'Invalid run id' });
    }

    const { rows } = await sql`
      SELECT r.*, c.name AS canonical_company_name, c.run_count
      FROM runs r
      JOIN companies c ON c.id = r.company_id
      WHERE r.id = ${id}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }
    const run = rows[0];

    // Fetch prior run (if any)
    let priorRun = null;
    if (run.prior_run_id) {
      const { rows: priorRows } = await sql`
        SELECT id, created_at, weighted_risk_score, weighted_readiness_score,
               quadrant, partner_posture
        FROM runs
        WHERE id = ${run.prior_run_id}
        LIMIT 1
      `;
      priorRun = priorRows[0] || null;
    }

    // Fetch documents
    const { rows: docRows } = await sql`
      SELECT id, name, type, size_bytes, uploaded_at
      FROM documents
      WHERE run_id = ${id}
      ORDER BY uploaded_at ASC
    `;

    // Reconstruct the payload shape the report page expects:
    // { company, result, meta, generated_at }
    const payload = {
      company: {
        name: run.company_name,
        domain: run.company_domain,
        vertical: run.company_vertical,
        context: run.company_context
      },
      result: run.result_json,
      meta: run.meta_json,
      generated_at: run.created_at
    };

    return res.status(200).json({
      ok: true,
      run: {
        id: run.id,
        company_id: run.company_id,
        created_at: run.created_at,
        weighted_risk_score: Number(run.weighted_risk_score),
        weighted_readiness_score: Number(run.weighted_readiness_score),
        quadrant: run.quadrant,
        partner_posture: run.partner_posture,
        conviction: run.conviction,
        confidence_level: run.confidence_level,
        delta_narrative: run.delta_narrative,
        risk_score_delta: run.risk_score_delta != null ? Number(run.risk_score_delta) : null,
        readiness_score_delta: run.readiness_score_delta != null ? Number(run.readiness_score_delta) : null,
        quadrant_changed: run.quadrant_changed
      },
      prior_run: priorRun,
      documents: docRows,
      payload // ready to hand off to report.html
    });
  } catch (err) {
    console.error('[runs GET id] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch run', detail: err.message });
  }
}
