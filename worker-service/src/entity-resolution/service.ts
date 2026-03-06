import { randomUUID } from "node:crypto";
import { insertAuditLog } from "../db/audit.js";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

function jaccardSimilarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;

  let intersection = 0;
  for (const token of ta) {
    if (tb.has(token)) intersection += 1;
  }
  const union = ta.size + tb.size - intersection;
  if (!union) return 0;
  return intersection / union;
}

function getAutoResolveThreshold(db) {
  const row = db
    .prepare("SELECT value FROM config_item WHERE key = 'entity_auto_resolve_threshold'")
    .get();

  const parsed = Number(row?.value);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) {
    return parsed;
  }
  return 0.85;
}

function listCompaniesAndAliases(db) {
  const companies = db
    .prepare(
      `SELECT c.id, c.uen, c.registered_name, i.code AS industry_code
       FROM company c
       LEFT JOIN industry i ON i.id = c.industry_id
       WHERE c.is_active = 1`
    )
    .all();

  const aliases = db
    .prepare(
      `SELECT ca.company_id, ca.alias, ca.source
       FROM company_alias ca
       JOIN company c ON c.id = ca.company_id
       WHERE c.is_active = 1`
    )
    .all();

  const aliasesByCompany = new Map();
  for (const alias of aliases) {
    if (!aliasesByCompany.has(alias.company_id)) {
      aliasesByCompany.set(alias.company_id, []);
    }
    aliasesByCompany.get(alias.company_id).push(alias);
  }

  return companies.map((company) => ({
    ...company,
    aliases: aliasesByCompany.get(company.id) || []
  }));
}

function getRawDocument(db, rawDocumentId) {
  return db
    .prepare(
      `SELECT id, source_id, title
       FROM raw_document
       WHERE id = ?`
    )
    .get(rawDocumentId);
}

function findBestMatch(raw, companies) {
  const text = `${raw.title || ""}`;
  const normalizedText = normalizeText(text);

  let best = null;

  for (const company of companies) {
    const registeredName = company.registered_name;
    const normalizedRegistered = normalizeText(registeredName);

    if (normalizedRegistered && normalizedText.includes(normalizedRegistered)) {
      const candidate = {
        companyId: company.id,
        companyUen: company.uen,
        companyName: company.registered_name,
        matchedAlias: company.registered_name,
        confidence: 0.98,
        method: "exact"
      };
      if (!best || candidate.confidence > best.confidence) {
        best = candidate;
      }
    }

    for (const alias of company.aliases) {
      const normalizedAlias = normalizeText(alias.alias);
      if (!normalizedAlias) continue;

      if (normalizedText.includes(normalizedAlias)) {
        const candidate = {
          companyId: company.id,
          companyUen: company.uen,
          companyName: company.registered_name,
          matchedAlias: alias.alias,
          confidence: 0.92,
          method: "alias"
        };
        if (!best || candidate.confidence > best.confidence) {
          best = candidate;
        }
      }
    }

    const fuzzy = jaccardSimilarity(text, registeredName);
    if (fuzzy >= 0.5) {
      const confidence = Number((0.6 + fuzzy * 0.3).toFixed(4));
      const candidate = {
        companyId: company.id,
        companyUen: company.uen,
        companyName: company.registered_name,
        matchedAlias: company.registered_name,
        confidence,
        method: "fuzzy"
      };
      if (!best || candidate.confidence > best.confidence) {
        best = candidate;
      }
    }
  }

  return best;
}

function upsertResolution(db, payload) {
  const existing = db
    .prepare("SELECT * FROM entity_resolution WHERE raw_document_id = ?")
    .get(payload.rawDocumentId);

  if (!existing) {
    const created = {
      id: randomUUID(),
      raw_document_id: payload.rawDocumentId,
      matched_company_id: payload.matchedCompanyId,
      confidence: payload.confidence,
      method: payload.method,
      status: payload.status,
      matched_alias: payload.matchedAlias || null,
      reason: payload.reason || null,
      reviewed_by: null,
      reviewed_at: null
    };

    db
      .prepare(
        `INSERT INTO entity_resolution (
          id, raw_document_id, matched_company_id, confidence, method, status, matched_alias, reason, reviewed_by, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        created.id,
        created.raw_document_id,
        created.matched_company_id,
        created.confidence,
        created.method,
        created.status,
        created.matched_alias,
        created.reason,
        created.reviewed_by,
        created.reviewed_at
      );

    return { before: null, after: db.prepare("SELECT * FROM entity_resolution WHERE id = ?").get(created.id) };
  }

  db
    .prepare(
      `UPDATE entity_resolution
       SET matched_company_id = ?,
           confidence = ?,
           method = ?,
           status = ?,
           matched_alias = ?,
           reason = ?,
           reviewed_by = NULL,
           reviewed_at = NULL
       WHERE id = ?`
    )
    .run(
      payload.matchedCompanyId,
      payload.confidence,
      payload.method,
      payload.status,
      payload.matchedAlias || null,
      payload.reason || null,
      existing.id
    );

  return {
    before: existing,
    after: db.prepare("SELECT * FROM entity_resolution WHERE id = ?").get(existing.id)
  };
}

export function resolveEntities(db, input) {
  const { rawDocumentId, ingestionRunId, actorUserId } = input;
  if (!rawDocumentId && !ingestionRunId) {
    throw new Error("Provide rawDocumentId or ingestionRunId");
  }

  const companies = listCompaniesAndAliases(db);
  const threshold = getAutoResolveThreshold(db);

  let docs = [];
  if (rawDocumentId) {
    const one = getRawDocument(db, rawDocumentId);
    if (!one) throw new Error("raw_document not found");
    docs = [one];
  } else {
    docs = db
      .prepare(
        `SELECT id, source_id, title
         FROM raw_document
         WHERE ingestion_run_id = ?
         ORDER BY fetched_at`
      )
      .all(ingestionRunId);
    if (!docs.length) {
      throw new Error("No raw documents found for ingestion run");
    }
  }

  const results = [];
  db.exec("BEGIN;");
  try {
    for (const doc of docs) {
      const match = findBestMatch(doc, companies);
      const payload = match
        ? {
            rawDocumentId: doc.id,
            matchedCompanyId: match.companyId,
            confidence: match.confidence,
            method: match.method,
            matchedAlias: match.matchedAlias,
            status: match.confidence >= threshold ? "auto_resolved" : "review_required",
            reason: match.confidence >= threshold ? "auto-resolved by threshold" : "below confidence threshold"
          }
        : {
            rawDocumentId: doc.id,
            matchedCompanyId: null,
            confidence: 0,
            method: "fuzzy",
            matchedAlias: null,
            status: "review_required",
            reason: "no candidate match found"
          };

      const { before, after } = upsertResolution(db, payload);
      insertAuditLog(db, {
        actorUserId,
        action: before ? "entity_resolution.updated" : "entity_resolution.created",
        entityType: "entity_resolution",
        entityId: after.id,
        beforeState: before,
        afterState: after
      });

      results.push(after);
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return {
    threshold,
    processed: results.length,
    results
  };
}

export function listReviewQueue(db, input) {
  const limit = Math.max(1, Math.min(100, Number(input.limit || 20)));
  const offset = Math.max(0, Number(input.offset || 0));

  const rows = db
    .prepare(
      `SELECT er.id, er.raw_document_id, er.matched_company_id, er.matched_alias, er.confidence, er.method, er.status, er.reason,
              rd.title AS raw_title, rd.url AS raw_url, rd.published_at, c.registered_name AS matched_company_name, c.uen AS matched_company_uen
       FROM entity_resolution er
       JOIN raw_document rd ON rd.id = er.raw_document_id
       LEFT JOIN company c ON c.id = er.matched_company_id
       WHERE er.status = 'review_required'
       ORDER BY er.confidence DESC, rd.published_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);

  return { data: rows, limit, offset };
}

export function approveEntityResolution(db, resolutionId, body) {
  const { companyId, actorUserId, alias } = body;
  if (!companyId) {
    throw new Error("Missing required field: companyId");
  }

  const exists = db.prepare("SELECT id, registered_name FROM company WHERE id = ?").get(companyId);
  if (!exists) {
    throw new Error("company not found");
  }

  const before = db.prepare("SELECT * FROM entity_resolution WHERE id = ?").get(resolutionId);
  if (!before) {
    throw new Error("entity_resolution not found");
  }

  db.exec("BEGIN;");
  try {
    db
      .prepare(
        `UPDATE entity_resolution
         SET status = 'approved',
             matched_company_id = ?,
             method = 'manual',
             matched_alias = COALESCE(?, matched_alias),
             reason = 'manually approved',
             reviewed_by = ?,
             reviewed_at = current_timestamp
         WHERE id = ?`
      )
      .run(companyId, alias || null, actorUserId || null, resolutionId);

    if (alias) {
      db
        .prepare(
          `INSERT INTO company_alias (id, company_id, alias, source)
           VALUES (?, ?, ?, 'manual_approval')
           ON CONFLICT(company_id, alias) DO NOTHING`
        )
        .run(randomUUID(), companyId, alias);
    }

    const after = db.prepare("SELECT * FROM entity_resolution WHERE id = ?").get(resolutionId);

    insertAuditLog(db, {
      actorUserId,
      action: "entity_resolution.approved",
      entityType: "entity_resolution",
      entityId: resolutionId,
      beforeState: before,
      afterState: after
    });

    db.exec("COMMIT;");
    return after;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function rejectEntityResolution(db, resolutionId, body) {
  const { reason, actorUserId } = body;
  if (!reason) {
    throw new Error("Missing required field: reason");
  }

  const before = db.prepare("SELECT * FROM entity_resolution WHERE id = ?").get(resolutionId);
  if (!before) {
    throw new Error("entity_resolution not found");
  }

  db.exec("BEGIN;");
  try {
    db
      .prepare(
        `UPDATE entity_resolution
         SET status = 'rejected',
             reason = ?,
             reviewed_by = ?,
             reviewed_at = current_timestamp
         WHERE id = ?`
      )
      .run(reason, actorUserId || null, resolutionId);

    const after = db.prepare("SELECT * FROM entity_resolution WHERE id = ?").get(resolutionId);

    insertAuditLog(db, {
      actorUserId,
      action: "entity_resolution.rejected",
      entityType: "entity_resolution",
      entityId: resolutionId,
      beforeState: before,
      afterState: after
    });

    db.exec("COMMIT;");
    return after;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function listCompanyAliases(db, companyId) {
  const company = db.prepare("SELECT id, uen, registered_name FROM company WHERE id = ?").get(companyId);
  if (!company) {
    throw new Error("company not found");
  }

  const aliases = db
    .prepare(
      `SELECT id, alias, source
       FROM company_alias
       WHERE company_id = ?
       ORDER BY alias`
    )
    .all(companyId);

  return {
    company,
    aliases
  };
}

export function addCompanyAlias(db, companyId, body) {
  const { alias, source = "manual", actorUserId } = body;
  if (!alias) {
    throw new Error("Missing required field: alias");
  }

  const company = db.prepare("SELECT id FROM company WHERE id = ?").get(companyId);
  if (!company) {
    throw new Error("company not found");
  }

  const id = randomUUID();

  db.exec("BEGIN;");
  try {
    db
      .prepare(
        `INSERT INTO company_alias (id, company_id, alias, source)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(company_id, alias) DO NOTHING`
      )
      .run(id, companyId, alias, source);

    const row = db
      .prepare(
        `SELECT id, company_id, alias, source
         FROM company_alias
         WHERE company_id = ? AND alias = ?`
      )
      .get(companyId, alias);

    insertAuditLog(db, {
      actorUserId,
      action: "company_alias.upserted",
      entityType: "company_alias",
      entityId: row.id,
      beforeState: null,
      afterState: row
    });

    db.exec("COMMIT;");
    return row;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
