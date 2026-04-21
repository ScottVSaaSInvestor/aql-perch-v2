// ============================================================
// /api/runs/[id]
// ------------------------------------------------------------
// GET    — fetch single run for IC report replay
// DELETE — remove a single run from the corpus
// ============================================================

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const id = Number(req.query.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid run id' });
  }

  if (req.method === 'GET')    return handleGet(req, res, id);
  if (req.method === 'DELETE') return handleDelete(req, res, id);
  return res.status(405).json({ error: 'Method not allowed' });
}

// ============================================================
// GET — fetch single run
// ============================================================
async function handleGet(req, res, id) {
  try {
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

    const { rows: docRows } = await sql`
      SELECT id, name, type, size_bytes, uploaded_at
      FROM documents
      WHERE run_id = ${id}
      ORDER BY uploaded_at ASC
    `;

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
      payload
    });
  } catch (err) {
    console.error('[runs GET id]', err);
    return res.status(500).json({ error: 'Failed to fetch run', detail: err.message });
  }
}

// ============================================================
// DELETE — remove a run
// ------------------------------------------------------------
// Cascading delete handled by ON DELETE CASCADE on documents.
// Also decrements company.run_count; if run_count hits 0, removes
// the company row too so the dashboard stays clean.
// ============================================================
async function handleDelete(req, res, id) {
  try {
    // Fetch the run so we know the company
    const { rows: runRows } = await sql`
      SELECT id, company_id, company_name FROM runs WHERE id = ${id} LIMIT 1
    `;
    if (runRows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }
    const companyId = runRows[0].company_id;
    const companyName = runRows[0].company_name;

    // If this run is referenced as prior_run_id by a newer run, null out that reference
    // (the newer run's delta narrative will be slightly stale, but no foreign-key error)
    await sql`
      UPDATE runs
      SET prior_run_id = NULL, delta_narrative = NULL,
          risk_score_delta = NULL, readiness_score_delta = NULL,
          quadrant_changed = FALSE
      WHERE prior_run_id = ${id}
    `;

    // Delete the run (documents cascade)
    await sql`DELETE FROM runs WHERE id = ${id}`;

    // Decrement the company's run_count, then clean up if zero
    const { rows: companyRows } = await sql`
      UPDATE companies
      SET run_count = GREATEST(run_count - 1, 0)
      WHERE id = ${companyId}
      RETURNING id, run_count
    `;
    const newRunCount = companyRows[0]?.run_count ?? 0;

    let companyRemoved = false;
    if (newRunCount === 0) {
      await sql`DELETE FROM companies WHERE id = ${companyId}`;
      companyRemoved = true;
    }

    return res.status(200).json({
      ok: true,
      deleted_run_id: id,
      company_id: companyId,
      company_name: companyName,
      company_removed: companyRemoved,
      remaining_runs_for_company: newRunCount
    });
  } catch (err) {
    console.error('[runs DELETE id]', err);
    return res.status(500).json({ error: 'Failed to delete run', detail: err.message });
  }
}
