import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import crypto from 'crypto';
import { Connector, IngestionRange } from './types';
import { LocalFileStorage } from '../storage/local-file-storage';

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

    private async getDb(): Promise<Database> {
        return open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });
    }

    async runBackfill(sourceId: string, range: IngestionRange, options?: Record<string, any>) {
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
            [runId, sourceId, 'running', range.start.toISOString(), range.end.toISOString()]
        );

        try {
            console.log(`[IngestionEngine] Starting backfill for ${sourceId}`);
            let cursor: string | undefined = undefined;
            let totalPulled = 0;
            const records: any[] = [];

            do {
                const result = await connector.pull(range, cursor, options);

                if (result.records) {
                    records.push(...result.records);
                }

                for (const doc of result.documents) {
                    // Save to local file storage
                    const localPath = await this.storage.saveRawDocument(sourceId, doc.id, doc.content, doc.metadata);

                    // Save metadata to db
                    await db.run(
                        `INSERT OR REPLACE INTO raw_document (id, run_id, source_id, external_id, title, url, fetched_at, published_at, local_path)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [doc.id, runId, sourceId, doc.externalId, doc.title, doc.url, doc.fetchedAt, doc.publishedAt, localPath]
                    );
                    totalPulled++;
                }

                cursor = result.cursor;
            } while (cursor);

            await db.run(
                `UPDATE ingestion_run SET status = 'success', records_pulled = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [totalPulled + records.length, runId]
            );

            console.log(`[IngestionEngine] Backfill for ${sourceId} completed. Pulled ${totalPulled + records.length} records.`);
            await db.close();
            return { runId, status: 'success', recordsPulled: totalPulled + records.length, records };

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
}
