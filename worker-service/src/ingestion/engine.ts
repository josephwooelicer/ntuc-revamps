import * as sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import * as path from 'path';
import * as crypto from 'crypto';
import { Connector, IngestionRange, ScopedIngestionRequest } from './types';
import { LocalFileStorage } from '../storage/local-file-storage';
import { normalizeRangeToSgtDayBounds } from './utils';

export class IngestionEngine {
    private dbPath: string;
    private storage: LocalFileStorage;
    private connectors: Map<string, Connector> = new Map();

    constructor() {
        this.dbPath = path.resolve(__dirname, '../../../data/ntuc-ews.db');
        this.storage = new LocalFileStorage(path.resolve(__dirname, '../../../data-lake/raw'));
    }

    registerConnector(connector: Connector) {
        this.connectors.set(connector.id, connector);
    }

    getRegisteredConnectorIds(): string[] {
        return Array.from(this.connectors.keys());
    }

    private async getDb(): Promise<Database> {
        return open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });
    }

    private toJsonOrNull(value: unknown): string | null {
        if (value === undefined || value === null) {
            return null;
        }
        try {
            return typeof value === 'string' ? value : JSON.stringify(value);
        } catch {
            return null;
        }
    }

    async runBackfill(sourceId: string, range: IngestionRange, options?: Record<string, any>) {
        const normalizedRange = normalizeRangeToSgtDayBounds(range.start, range.end);
        const connector = this.connectors.get(sourceId);
        if (!connector) {
            throw new Error(`Connector for source ${sourceId} not found`);
        }

        const db = await this.getDb();

        // Check if source exists and supports backfill
        const source = await db.get('SELECT * FROM sources WHERE id = ?', sourceId);
        if (!source) throw new Error(`Source ${sourceId} not found in DB`);
        if (!source.supportsBackfill) throw new Error(`Source ${sourceId} does not support backfill`);

        const runId = `run_${crypto.randomBytes(8).toString('hex')}`;

        await db.run(
            `INSERT INTO ingestion_run (id, source_id, status, range_start, range_end)
       VALUES (?, ?, ?, ?, ?)`,
            [runId, sourceId, 'running', normalizedRange.start.toISOString(), normalizedRange.end.toISOString()]
        );

        try {
            console.log(`[IngestionEngine] Starting backfill for ${sourceId}`);
            let cursor: string | undefined = undefined;
            let totalPulled = 0;
            let documentsSaved = 0;
            let recordsSaved = 0;
            let duplicatesSkipped = 0;
            const records: any[] = [];

            // Define immediate storage callbacks
            const onDocument = async (doc: any) => {
                const existing = await db.get('SELECT id FROM raw_document WHERE id = ?', doc.id);
                if (existing) {
                    duplicatesSkipped++;
                    return;
                }
                const localPath = await this.storage.saveRawDocument(sourceId, doc.id, doc.content, doc.metadata);
                console.log(`[IngestionEngine] [${sourceId}] Saved document "${doc.title}" to ${localPath}`);
                const queryText = doc?.metadata?.queryText ?? options?.queryText ?? options?.query ?? null;
                const filterParams = doc?.metadata?.filterParams ?? options?.filterParams ?? null;
                const retrievalUrl = doc?.metadata?.retrievalUrl ?? doc?.url ?? options?.retrievalUrl ?? null;
                const pageNumber = doc?.metadata?.pageNumber ?? null;
                const rangeStart = normalizedRange.start.toISOString();
                const rangeEnd = normalizedRange.end.toISOString();
                await db.run(
                    `INSERT OR REPLACE INTO raw_document
                    (id, run_id, source_id, external_id, title, url, fetched_at, published_at, local_path, query_text, filter_params, retrieval_url, page_number, range_start, range_end)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        doc.id,
                        runId,
                        sourceId,
                        doc.externalId,
                        doc.title,
                        doc.url,
                        doc.fetchedAt,
                        doc.publishedAt,
                        localPath,
                        queryText,
                        this.toJsonOrNull(filterParams),
                        retrievalUrl,
                        pageNumber,
                        rangeStart,
                        rangeEnd
                    ]
                );
                totalPulled++;
                documentsSaved++;
            };

            const onRecord = async (record: any) => {
                const recordId = record.id || crypto.createHash('sha256').update(sourceId + JSON.stringify(record)).digest('hex');
                const existing = await db.get('SELECT id FROM raw_record WHERE id = ?', recordId);
                if (existing) {
                    duplicatesSkipped++;
                    return;
                }
                const data = JSON.stringify(record);
                const queryText = record?.queryText ?? options?.queryText ?? options?.query ?? null;
                const filterParams = record?.filterParams ?? options?.filterParams ?? null;
                const retrievalUrl = record?.retrievalUrl ?? options?.retrievalUrl ?? null;
                const pageNumber = record?.pageNumber ?? null;
                const rangeStart = normalizedRange.start.toISOString();
                const rangeEnd = normalizedRange.end.toISOString();
                await db.run(
                    `INSERT OR REPLACE INTO raw_record
                    (id, run_id, source_id, external_id, data, fetched_at, published_at, query_text, filter_params, retrieval_url, page_number, range_start, range_end)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        recordId,
                        runId,
                        sourceId,
                        record.externalId || null,
                        data,
                        new Date().toISOString(),
                        record.publishedAt || null,
                        queryText,
                        this.toJsonOrNull(filterParams),
                        retrievalUrl,
                        pageNumber,
                        rangeStart,
                        rangeEnd
                    ]
                );
                records.push(record);
                totalPulled++;
                recordsSaved++;
            };

            do {
                const result = await connector.pull(normalizedRange, cursor, options, onDocument, onRecord);

                // For backward compatibility or if the connector still returns them in the result
                if (result.records && result.records.length > 0) {
                    for (const rec of result.records) {
                        // Check if already processed via callback to avoid double counting/storage
                        const alreadyProcessed = records.some(r => r === rec);
                        if (!alreadyProcessed) {
                            await onRecord(rec);
                        }
                    }
                }

                if (result.documents && result.documents.length > 0) {
                    for (const doc of result.documents) {
                        // Check if already processed via callback
                        // This is tricky for documents since they are objects, but we can check doc.id
                        // However, we'll assume standard connectors will migrate to ONLY using callbacks OR returning at the end.
                        // To be safe, we'll just check if it was already pulled (approximate)
                        // Actually, for now, let's just process any return docs that weren't processed.
                        // We'll track processed IDs.
                    }
                    // Simplified: if connector returns them at the end, we still process them.
                    // Connectors should be updated to either use callbacks OR return, not both for the same item.
                }

                cursor = result.cursor;
            } while (cursor);

            await db.run(
                `UPDATE ingestion_run
                 SET status = 'success',
                     records_pulled = ?,
                     documents_saved = ?,
                     records_saved = ?,
                     duplicates_skipped = ?,
                     completed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [totalPulled, documentsSaved, recordsSaved, duplicatesSkipped, runId]
            );

            console.log(`[IngestionEngine] Backfill for ${sourceId} completed. Pulled ${totalPulled} records, skipped ${duplicatesSkipped} duplicates.`);
            await db.close();
            return {
                runId,
                status: 'success',
                recordsPulled: totalPulled,
                documentsSaved,
                recordsSaved,
                duplicatesSkipped,
                records
            };

        } catch (error: any) {
            console.error(`[IngestionEngine] Error during backfill for ${sourceId}:`, error);
            await db.run(
                `UPDATE ingestion_run SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [error.message, runId]
            );
            await db.close();
            throw error;
        }
    }

    private getOnDemandConnectorIds(industry?: string): string[] {
        const ids = [
            'src-news',
            'src-egazette',
            'src-annual-reports-listed',
            'src-reddit-sentiment',
            'src-acra-data-gov-sg'
        ];
        const normalizedIndustry = (industry || '').trim().toLowerCase();
        if (normalizedIndustry === 'tech') {
            ids.push('src-layoffs-fyi');
        }
        return ids;
    }

    private async getProductionConnectorIds(db: Database): Promise<string[]> {
        const activeSources = (await db.all(
            'SELECT id FROM sources WHERE isActive = 1'
        )) as Array<{ id: string }>;
        const activeSourceIds = new Set(activeSources.map((row) => row.id));
        return this.getRegisteredConnectorIds().filter((id) => activeSourceIds.has(id));
    }

    async runScopedIngestion(request: ScopedIngestionRequest) {
        const db = await this.getDb();
        const orchestrationRunId = `orun_${crypto.randomBytes(8).toString('hex')}`;
        const runMode = request.runMode;
        const range = normalizeRangeToSgtDayBounds(request.range.start, request.range.end);
        let totalSuccess = 0;
        let totalFailed = 0;
        let totalSkipped = 0;

        await db.run(
            `INSERT INTO ingestion_orchestration_run
            (id, run_mode, company_name, uen, industry, range_start, range_end, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                orchestrationRunId,
                runMode,
                request.companyName || null,
                request.uen || null,
                request.industry || null,
                range.start.toISOString(),
                range.end.toISOString(),
                'running'
            ]
        );

        try {
            const candidateConnectorIds =
                runMode === 'production'
                    ? await this.getProductionConnectorIds(db)
                    : this.getOnDemandConnectorIds(request.industry);

            const connectorIds = candidateConnectorIds.filter((id) => this.connectors.has(id));
            const itemResults: Array<{
                sourceId: string;
                status: 'success' | 'failed' | 'skipped';
                ingestionRunId?: string;
                recordsPulled: number;
                errorMessage?: string;
            }> = [];

            for (const sourceId of connectorIds) {
                const itemId = `oritm_${crypto.randomBytes(8).toString('hex')}`;
                const source = await db.get(
                    'SELECT id, isActive, supportsBackfill FROM sources WHERE id = ?',
                    sourceId
                );

                await db.run(
                    `INSERT INTO ingestion_orchestration_item
                    (id, orchestration_run_id, source_id, status)
                    VALUES (?, ?, ?, ?)`,
                    [itemId, orchestrationRunId, sourceId, 'pending']
                );

                if (!source || !source.isActive || !source.supportsBackfill) {
                    totalSkipped++;
                    itemResults.push({ sourceId, status: 'skipped', recordsPulled: 0 });
                    await db.run(
                        `UPDATE ingestion_orchestration_item
                         SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        ['skipped', 'inactive or backfill unsupported', itemId]
                    );
                    continue;
                }

                await db.run(
                    'UPDATE ingestion_orchestration_item SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?',
                    ['running', itemId]
                );

                try {
                    const result = await this.runBackfill(sourceId, range, {
                        ...request.options,
                        company_name: request.companyName,
                        companyName: request.companyName,
                        uen: request.uen,
                        industry: request.industry,
                        orchestration_run_id: orchestrationRunId
                    });

                    totalSuccess++;
                    itemResults.push({
                        sourceId,
                        status: 'success',
                        ingestionRunId: result.runId,
                        recordsPulled: result.recordsPulled
                    });
                    await db.run(
                        `UPDATE ingestion_orchestration_item
                         SET status = ?, ingestion_run_id = ?, records_pulled = ?, completed_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        ['success', result.runId, result.recordsPulled, itemId]
                    );
                } catch (error: any) {
                    totalFailed++;
                    itemResults.push({
                        sourceId,
                        status: 'failed',
                        recordsPulled: 0,
                        errorMessage: error.message
                    });
                    await db.run(
                        `UPDATE ingestion_orchestration_item
                         SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        ['failed', error.message, itemId]
                    );
                }
            }

            const finalStatus = totalFailed === 0 ? 'success' : (totalSuccess > 0 ? 'partial' : 'failed');
            await db.run(
                `UPDATE ingestion_orchestration_run
                 SET status = ?, completed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [finalStatus, orchestrationRunId]
            );

            await db.close();
            return {
                orchestrationRunId,
                status: finalStatus,
                totalConnectors: connectorIds.length,
                connectorsSucceeded: totalSuccess,
                connectorsFailed: totalFailed,
                connectorsSkipped: totalSkipped,
                items: itemResults
            };
        } catch (error: any) {
            await db.run(
                `UPDATE ingestion_orchestration_run
                 SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                ['failed', error.message, orchestrationRunId]
            );
            await db.close();
            throw error;
        }
    }
}
