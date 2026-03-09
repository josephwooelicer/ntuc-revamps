import * as sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import * as path from 'path';
import * as crypto from 'crypto';
import { normalizeRangeToSgtDayBounds } from '../ingestion/utils';

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

            for (const target of targets) {
                const itemId = `pitm_${crypto.randomBytes(8).toString('hex')}`;
                await db.run(
                    `INSERT INTO processing_item
                    (id, processing_run_id, ingestion_run_id, source_id, status)
                    VALUES (?, ?, ?, ?, ?)`,
                    [itemId, processingRunId, target.ingestionRunId, target.sourceId, 'running']
                );

                try {
                    const rawDocCountRow = await db.get(
                        `SELECT COUNT(1) AS count
                         FROM raw_document
                         WHERE run_id = ?`,
                        target.ingestionRunId
                    ) as { count: number };
                    const rawRecordCountRow = await db.get(
                        `SELECT COUNT(1) AS count
                         FROM raw_record
                         WHERE run_id = ?`,
                        target.ingestionRunId
                    ) as { count: number };

                    const rawDocCount = rawDocCountRow?.count || 0;
                    const rawRecordCount = rawRecordCountRow?.count || 0;
                    totalDocsSeen += rawDocCount;
                    totalRecordsSeen += rawRecordCount;
                    processedCount++;

                    await db.run(
                        `UPDATE processing_item
                         SET status = ?, raw_documents_seen = ?, raw_records_seen = ?, completed_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        ['success', rawDocCount, rawRecordCount, itemId]
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
                     completed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    finalStatus,
                    targets.length,
                    processedCount,
                    totalDocsSeen,
                    totalRecordsSeen,
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
                rawRecordsSeen: totalRecordsSeen
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
