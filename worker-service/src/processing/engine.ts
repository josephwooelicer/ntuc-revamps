import * as sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import * as path from 'path';
import * as crypto from 'crypto';
import { normalizeRangeToSgtDayBounds } from '../ingestion/utils';
import { SHARED_MATRIX_VERSION } from './evaluation-matrix';
import { parseNewsRows, readNewsCsv } from './news-parser';
import { parseEgazettePdf } from './egazette-parser';
import { parseAnnualReportRows, readAnnualReportCsv } from './annual-report-parser';
import { parseRedditCommentSentiment, readRedditCommentsCsv } from './reddit-parser';
import { parseDataGovDocument } from './data-gov-parser';

type ProcessingRunMode = 'debug_on_demand' | 'production';

export interface ProcessingRunRequest {
    runMode: ProcessingRunMode;
    ingestionOrchestrationRunId?: string;
    rangeStart?: Date;
    rangeEnd?: Date;
}

type IngestionRunTarget = {
    ingestionRunId: string;
    sourceId: string;
};

type EntityResolutionResult = {
    entityName: string;
    uen: string | null;
    confidence: number;
    reason: string;
};

export class ProcessingEngine {
    private dbPath: string;

    constructor() {
        this.dbPath = path.resolve(__dirname, '../../../data/ntuc-ews.db');
    }

    private async getDb(): Promise<Database> {
        return open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });
    }

    private async getTargetsForOnDemand(
        db: Database,
        ingestionOrchestrationRunId: string
    ): Promise<IngestionRunTarget[]> {
        const orchestrationRun = await db.get(
            `SELECT id, status
             FROM ingestion_orchestration_run
             WHERE id = ?`,
            ingestionOrchestrationRunId
        );
        if (!orchestrationRun) {
            throw new Error(`Orchestration run ${ingestionOrchestrationRunId} not found`);
        }

        const rows = await db.all(
            `SELECT io.ingestion_run_id as ingestionRunId, io.source_id as sourceId
             FROM ingestion_orchestration_item io
             JOIN ingestion_run ir ON ir.id = io.ingestion_run_id
             WHERE io.orchestration_run_id = ?
               AND io.status = 'success'
               AND ir.status = 'success'
               AND io.ingestion_run_id IS NOT NULL`,
            ingestionOrchestrationRunId
        ) as IngestionRunTarget[];
        return rows;
    }

    private async getTargetsForProduction(
        db: Database,
        rangeStart?: Date,
        rangeEnd?: Date
    ): Promise<IngestionRunTarget[]> {
        if (rangeStart && rangeEnd) {
            const normalized = normalizeRangeToSgtDayBounds(rangeStart, rangeEnd);
            const rows = await db.all(
                `SELECT id as ingestionRunId, source_id as sourceId
                 FROM ingestion_run
                 WHERE status = 'success'
                   AND completed_at IS NOT NULL
                   AND completed_at BETWEEN ? AND ?
                 ORDER BY completed_at ASC`,
                normalized.start.toISOString(),
                normalized.end.toISOString()
            ) as IngestionRunTarget[];
            return rows;
        }

        const rows = await db.all(
            `SELECT id as ingestionRunId, source_id as sourceId
             FROM ingestion_run
             WHERE status = 'success'
             ORDER BY completed_at DESC
             LIMIT 100`
        ) as IngestionRunTarget[];
        return rows;
    }

    private normalizeName(input: string): string {
        return input.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    private async getEntityResolutionThreshold(db: Database): Promise<number> {
        const row = await db.get(
            `SELECT value FROM config WHERE key = 'entity_resolution_threshold' LIMIT 1`
        ) as { value?: string } | undefined;
        const parsed = Number(row?.value || '0.85');
        if (!Number.isFinite(parsed)) {
            return 0.85;
        }
        return Math.max(0, Math.min(1, parsed));
    }

    private async resolveEntityForNews(
        db: Database,
        companyName: string,
        explicitUen?: string | null
    ): Promise<EntityResolutionResult> {
        if (explicitUen) {
            const exactByUen = await db.get(
                `SELECT uen, entity_name FROM acra_entities WHERE uen = ? LIMIT 1`,
                explicitUen
            ) as { uen?: string; entity_name?: string } | undefined;
            return {
                entityName: exactByUen?.entity_name || companyName,
                uen: explicitUen,
                confidence: 1.0,
                reason: 'explicit_uen'
            };
        }

        const normInput = this.normalizeName(companyName);
        const exact = await db.get(
            `SELECT uen, entity_name
             FROM acra_entities
             WHERE REPLACE(LOWER(entity_name), ' ', '') = ?
             LIMIT 1`,
            normInput
        ) as { uen?: string; entity_name?: string } | undefined;
        if (exact?.uen) {
            return {
                entityName: exact.entity_name || companyName,
                uen: exact.uen,
                confidence: 0.95,
                reason: 'exact_name_match'
            };
        }

        const likeMatches = await db.all(
            `SELECT uen, entity_name
             FROM acra_entities
             WHERE LOWER(entity_name) LIKE ?
             LIMIT 5`,
            `%${companyName.toLowerCase()}%`
        ) as Array<{ uen: string; entity_name: string }>;
        if (likeMatches.length === 1) {
            return {
                entityName: likeMatches[0].entity_name,
                uen: likeMatches[0].uen,
                confidence: 0.8,
                reason: 'single_like_match'
            };
        }
        if (likeMatches.length > 1) {
            return {
                entityName: likeMatches[0].entity_name,
                uen: likeMatches[0].uen,
                confidence: 0.65,
                reason: 'multiple_like_matches'
            };
        }

        return {
            entityName: companyName,
            uen: null,
            confidence: 0.4,
            reason: 'no_match'
        };
    }

    async run(request: ProcessingRunRequest) {
        const db = await this.getDb();
        const processingRunId = `prun_${crypto.randomBytes(8).toString('hex')}`;

        await db.run(
            `INSERT INTO processing_run
            (id, run_mode, ingestion_orchestration_run_id, range_start, range_end, status)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                processingRunId,
                request.runMode,
                request.ingestionOrchestrationRunId || null,
                request.rangeStart ? request.rangeStart.toISOString() : null,
                request.rangeEnd ? request.rangeEnd.toISOString() : null,
                'running'
            ]
        );

        try {
            const targets =
                request.runMode === 'debug_on_demand'
                    ? await this.getTargetsForOnDemand(db, request.ingestionOrchestrationRunId || '')
                    : await this.getTargetsForProduction(db, request.rangeStart, request.rangeEnd);

            let processedCount = 0;
            let failedCount = 0;
            let totalDocsSeen = 0;
            let totalRecordsSeen = 0;
            let processedSignalsSaved = 0;
            let processedSignalsSkipped = 0;
            let processedSignalsFailed = 0;

            for (const target of targets) {
                const itemId = `pitm_${crypto.randomBytes(8).toString('hex')}`;
                await db.run(
                    `INSERT INTO processing_item
                    (id, processing_run_id, ingestion_run_id, source_id, status)
                    VALUES (?, ?, ?, ?, ?)`,
                    [itemId, processingRunId, target.ingestionRunId, target.sourceId, 'running']
                );

                try {
                    const rawDocRows = await db.all(
                        `SELECT id, local_path, source_id, url, title, query_text
                         FROM raw_document
                         WHERE run_id = ?`,
                        target.ingestionRunId
                    ) as Array<{ id: string; local_path: string; source_id: string; url: string; title: string; query_text?: string }>;
                    const rawDocCount = rawDocRows.length;
                    const rawDocCountRow = { count: rawDocCount };
                    const rawRecordCountRow = await db.get(
                        `SELECT COUNT(1) AS count
                         FROM raw_record
                         WHERE run_id = ?`,
                        target.ingestionRunId
                    ) as { count: number };

                    let itemSignalsSaved = 0;
                    let itemSignalsSkipped = 0;
                    let itemSignalsFailed = 0;

                    if (
                        target.sourceId === 'src-news' ||
                        target.sourceId === 'src-egazette' ||
                        target.sourceId === 'src-annual-reports-listed' ||
                        target.sourceId === 'src-reddit-sentiment' ||
                        target.sourceId === 'src-data-gov-sg'
                    ) {
                        const orchestration = await db.get(
                            `SELECT company_name, uen
                             FROM ingestion_orchestration_run
                             WHERE id = ?`,
                            request.ingestionOrchestrationRunId || null
                        ) as { company_name?: string; uen?: string } | undefined;
                        const fallbackDocCompany = rawDocRows.find((d) => !!d.query_text)?.query_text || null;
                        const companyName = orchestration?.company_name || fallbackDocCompany || 'unknown_company';
                        const explicitUen = orchestration?.uen || null;
                        const resolutionThreshold = await this.getEntityResolutionThreshold(db);
                        const entityResolution = await this.resolveEntityForNews(db, companyName, explicitUen);
                        const isIndustrySource = target.sourceId === 'src-data-gov-sg';
                        const shouldQueueReview = !isIndustrySource && entityResolution.confidence < resolutionThreshold;

                        for (const doc of rawDocRows) {
                            try {
                                let signals: Array<any> = [];
                                if (target.sourceId === 'src-news') {
                                    signals = await parseNewsRows(companyName, await readNewsCsv(doc.local_path));
                                } else if (target.sourceId === 'src-egazette') {
                                    signals = [await parseEgazettePdf({
                                        companyName,
                                        localPath: doc.local_path,
                                        sourceUrl: doc.url,
                                        title: doc.title || 'eGazette Document'
                                    })];
                                } else if (target.sourceId === 'src-annual-reports-listed') {
                                    signals = await parseAnnualReportRows(companyName, await readAnnualReportCsv(doc.local_path));
                                } else if (target.sourceId === 'src-reddit-sentiment') {
                                    const parsed = await parseRedditCommentSentiment({
                                        companyName,
                                        postTitle: doc.title || 'Reddit Post',
                                        postUrl: doc.url || '',
                                        comments: await readRedditCommentsCsv(doc.local_path)
                                    });
                                    signals = parsed ? [parsed] : [];
                                } else if (target.sourceId === 'src-data-gov-sg') {
                                    signals = [await parseDataGovDocument({
                                        localPath: doc.local_path,
                                        sourceUrl: doc.url || '',
                                        title: doc.title || 'data.gov.sg report',
                                        agency: String(doc.query_text || '')
                                    })];
                                }
                                for (const signal of signals) {
                                    if (
                                        target.sourceId !== 'src-annual-reports-listed' &&
                                        signal.label === 'irrelevant'
                                    ) {
                                        itemSignalsSkipped++;
                                        continue;
                                    }
                                    const signalId = crypto.createHash('sha256')
                                        .update(
                                            [
                                                target.sourceId,
                                                target.ingestionRunId,
                                                signal.canonicalUrl,
                                                signal.groupingKey
                                            ].join('|')
                                        )
                                        .digest('hex');

                                    const exists = await db.get(
                                        `SELECT id
                                         FROM processed_signal
                                         WHERE id = ?`,
                                        signalId
                                    );
                                    if (exists) {
                                        itemSignalsSkipped++;
                                        continue;
                                    }

                                    await db.run(
                                        `INSERT INTO processed_signal
                                        (id, processing_run_id, processing_item_id, ingestion_run_id, source_id, raw_document_id, entity_name, uen, event_type, signal_category, occurred_at, summary, canonical_url, grouping_key, matrix_version, matrix_scores, evaluation_label, final_score, parser_confidence, parser_version, evaluator_model, evaluator_reasoning, metadata, signal_level, impacted_industries)
                                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                        [
                                            signalId,
                                            processingRunId,
                                            itemId,
                                            target.ingestionRunId,
                                            target.sourceId,
                                            doc.id,
                                            isIndustrySource ? null : entityResolution.entityName,
                                            isIndustrySource ? null : (shouldQueueReview ? null : entityResolution.uen),
                                            signal.eventType,
                                            signal.signalCategory,
                                            signal.occurredAt,
                                            signal.summary,
                                            signal.canonicalUrl,
                                            signal.groupingKey,
                                            SHARED_MATRIX_VERSION,
                                            JSON.stringify(signal.matrixScores),
                                            signal.label,
                                            signal.finalScore,
                                            signal.parserConfidence,
                                            signal.parserVersion,
                                            signal.evaluatorModel,
                                            signal.evaluatorReasoning,
                                            JSON.stringify(signal.metadata),
                                            isIndustrySource ? 'industry' : 'company',
                                            isIndustrySource ? JSON.stringify(signal.impactedIndustries || []) : null
                                        ]
                                    );

                                    const evidenceId = crypto.randomBytes(12).toString('hex');
                                    await db.run(
                                        `INSERT INTO processed_signal_evidence
                                        (id, processed_signal_id, raw_document_id, source_url, local_path, query_text, filter_params, retrieval_url, page_number, range_start, range_end)
                                        SELECT ?, ?, rd.id, rd.url, rd.local_path, rd.query_text, rd.filter_params, rd.retrieval_url, rd.page_number, rd.range_start, rd.range_end
                                        FROM raw_document rd
                                        WHERE rd.id = ?`,
                                        [evidenceId, signalId, doc.id]
                                    );

                                    if (shouldQueueReview) {
                                        const reviewId = crypto.randomBytes(12).toString('hex');
                                        await db.run(
                                            `INSERT INTO entity_mapping_review_queue
                                            (id, processing_run_id, processing_item_id, processed_signal_id, source_id, candidate_entity_name, candidate_uen, confidence, threshold, reason, status)
                                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                                            [
                                                reviewId,
                                                processingRunId,
                                                itemId,
                                                signalId,
                                                target.sourceId,
                                                entityResolution.entityName,
                                                entityResolution.uen,
                                                entityResolution.confidence,
                                                resolutionThreshold,
                                                entityResolution.reason
                                            ]
                                        );
                                    }
                                    itemSignalsSaved++;
                                }
                            } catch (error: any) {
                                itemSignalsFailed++;
                                // continue processing other raw docs
                            }
                        }
                    }

                    processedSignalsSaved += itemSignalsSaved;
                    processedSignalsSkipped += itemSignalsSkipped;
                    processedSignalsFailed += itemSignalsFailed;

                    const rawRecordCount = rawRecordCountRow?.count || 0;
                    totalDocsSeen += rawDocCount;
                    totalRecordsSeen += rawRecordCount;
                    processedCount++;

                    await db.run(
                        `UPDATE processing_item
                         SET status = ?, raw_documents_seen = ?, raw_records_seen = ?, processed_signals_saved = ?, processed_signals_skipped = ?, processed_signals_failed = ?, completed_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        ['success', rawDocCount, rawRecordCount, itemSignalsSaved, itemSignalsSkipped, itemSignalsFailed, itemId]
                    );
                } catch (error: any) {
                    failedCount++;
                    await db.run(
                        `UPDATE processing_item
                         SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        ['failed', error.message, itemId]
                    );
                }
            }

            const finalStatus =
                failedCount === 0 ? 'success' : (processedCount > 0 ? 'partial' : 'failed');

            await db.run(
                `UPDATE processing_run
                 SET status = ?,
                     ingestion_runs_targeted = ?,
                     ingestion_runs_processed = ?,
                     raw_documents_seen = ?,
                     raw_records_seen = ?,
                     processed_signals_saved = ?,
                     processed_signals_skipped = ?,
                     processed_signals_failed = ?,
                     completed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    finalStatus,
                    targets.length,
                    processedCount,
                    totalDocsSeen,
                    totalRecordsSeen,
                    processedSignalsSaved,
                    processedSignalsSkipped,
                    processedSignalsFailed,
                    processingRunId
                ]
            );

            await db.close();
            return {
                processingRunId,
                status: finalStatus,
                ingestionRunsTargeted: targets.length,
                ingestionRunsProcessed: processedCount,
                ingestionRunsFailed: failedCount,
                rawDocumentsSeen: totalDocsSeen,
                rawRecordsSeen: totalRecordsSeen,
                processedSignalsSaved,
                processedSignalsSkipped,
                processedSignalsFailed
            };
        } catch (error: any) {
            await db.run(
                `UPDATE processing_run
                 SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                ['failed', error.message, processingRunId]
            );
            await db.close();
            throw error;
        }
    }
}
