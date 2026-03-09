import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright';
import { Connector, IngestionRange, IngestionResult, RawDocument } from '../types';

/**
 * AcraBulkSyncConnector downloads all 27 bulk CSV files from Data.gov.sg 
 * (A-Z and Others) and merges them into a local SQLite table `acra_entities`.
 * It uses Playwright to handle the browser-based download flow required by data.gov.sg V2.
 */
export class AcraBulkSyncConnector implements Connector {
    id = 'src-acra-bulk-sync';
    private dbPath = path.resolve(__dirname, '../../../../data/ntuc-ews.db');

    // Dataset IDs for the 27 ACRA bulk CSVs
    private datasetIds = [
        'd_8575e84912df3c28995b8e6e0e05205a', // A
        'd_3a3807c023c61ddfba947dc069eb53f2', // B
        'd_c0650f23e94c42e7a20921f4c5b75c24', // C
        'd_acbc938ec77af18f94cecc4a7c9ec720', // D
        'd_124a9bd407c7a25f8335b93b86e50fdd', // E
        'd_4526d47d6714d3b052eed4a30b8b1ed6', // F
        'd_b58303c68e9cf0d2ae93b73ffdbfbfa1', // G
        'd_fa2ed456cf2b8597bb7e064b08fc3c7c', // H
        'd_85518d970b8178975850457f60f1e738', // I
        'd_478f45a9c541cbe679ca55d1cd2b970b', // J
        'd_5573b0db0575db32190a2ad27919a7aa', // K
        'd_a2141adf93ec2a3c2ec2837b78d6d46e', // L
        'd_9af9317c646a1c881bb5591c91817cc6', // M
        'd_67e99e6eabc4aad9b5d48663b579746a', // N
        'd_5c4ef48b025fdfbc80056401f06e3df9', // O
        'd_181005ca270b45408b4cdfc954980ca2', // P
        'd_4130f1d9d365d9f1633536e959f62bb7', // Q
        'd_2b8c54b2a490d2fa36b925289e5d9572', // R
        'd_df7d2d661c0c11a7c367c9ee4bf896c1', // S
        'd_72f37e5c5d192951ddc5513c2b134482', // T
        'd_0cc5f52a1f298b916f317800251057f3', // U
        'd_e97e8e7fc55b85a38babf66b0fa46b73', // V
        'd_af2042c77ffaf0db5d75561ce9ef5688', // W
        'd_1cd970d8351b42be4a308d628a6dd9d3', // X
        'd_31af23fdb79119ed185c256f03cb5773', // Y
        'd_4e3db8955fdcda6f9944097bef3d2724', // Z
        'd_300ddc8da4e8f7bdc1bfc62d0d99e2e7', // Others
    ];

    async pull(range?: IngestionRange, cursor?: string, options?: Record<string, any>): Promise<IngestionResult> {
        console.log(`[AcraBulkSyncConnector] Starting bulk sync via Playwright...`);

        const db = await open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });

        const browser = await chromium.launch({ headless: true });
        let totalUpserted = 0;

        try {
            const context = await browser.newContext();

            // Allow limiting datasets for testing
            const datasetsToProcess = options?.limitDatasets
                ? this.datasetIds.slice(0, options.limitDatasets)
                : this.datasetIds;

            for (const datasetId of datasetsToProcess) {
                console.log(`[AcraBulkSyncConnector] Processing dataset: ${datasetId}`);
                const page = await context.newPage();

                try {
                    await page.goto(`https://data.gov.sg/datasets/${datasetId}/view`, { waitUntil: 'load', timeout: 60000 });
                    await page.waitForTimeout(3000);

                    // Trigger and wait for download
                    const [download] = await Promise.all([
                        page.waitForEvent('download', { timeout: 30000 }),
                        page.click('button:has-text("Download")', { force: true })
                    ]);

                    const downloadPath = await download.path();
                    if (!downloadPath) {
                        console.error(`Download failed for ${datasetId}`);
                        continue;
                    }

                    const csvStream = fs.readFileSync(downloadPath, 'utf8');
                    const lines = csvStream.split(/\r?\n/);
                    const dataLines = lines.slice(1); // Skip header
                    console.log(`[AcraBulkSyncConnector] Parsing ${dataLines.length} rows for ${datasetId}`);

                    const batchSize = 1000;
                    for (let i = 0; i < dataLines.length; i += batchSize) {
                        const batch = dataLines.slice(i, i + batchSize);
                        await db.exec('BEGIN TRANSACTION');
                        try {
                            for (const line of batch) {
                                const parts = this.parseCsvLine(line);
                                if (parts.length < 9) continue;

                                // Indices from metadata analysis:
                                // 0: uen
                                // 2: entity_name
                                // 3: entity_type_description
                                // 7: entity_status_description
                                // 8: registration_incorporation_date
                                const uen = parts[0];
                                const entity_name = parts[2];
                                const entity_type = parts[3];
                                const status = parts[7];
                                const registration_date = parts[8];

                                if (!uen || !entity_name) continue;

                                await db.run(
                                    `INSERT OR REPLACE INTO acra_entities (uen, entity_name, entity_type, status, registration_date)
                                     VALUES (?, ?, ?, ?, ?)`,
                                    [uen, entity_name, entity_type, status, registration_date]
                                );
                                totalUpserted++;
                            }
                            await db.exec('COMMIT');
                        } catch (err) {
                            await db.exec('ROLLBACK');
                            console.error(`Batch insert failed for ${datasetId} at index ${i}:`, err);
                        }
                    }
                } catch (err: any) {
                    console.error(`Failed to process ${datasetId}: ${err.message}`);
                } finally {
                    await page.close();
                }
            }

            console.log(`[AcraBulkSyncConnector] Sync completed. Upserted ${totalUpserted} entities.`);
        } finally {
            await browser.close();
            await db.close();
        }

        return { documents: [], cursor: undefined };
    }

    private parseCsvLine(line: string): string[] {
        const parts: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                parts.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        parts.push(current.trim());
        return parts.map(p => p.replace(/^"|"$/g, '').replace(/""/g, '"'));
    }
}

/**
 * AcraLocalSearchConnector searches the local `acra_entities` table.
 */
export class AcraLocalSearchConnector implements Connector {
    id = 'src-acra-data-gov-sg';
    private dbPath = path.resolve(__dirname, '../../../../data/ntuc-ews.db');

    async pull(range?: IngestionRange, cursor?: string, options?: Record<string, any>): Promise<IngestionResult> {
        const query = (options?.companyName || options?.query || '').toString().trim();
        if (!query) return { documents: [], cursor: undefined };

        console.log(`[AcraLocalSearchConnector] Local search for: ${query}`);

        const db = await open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });

        try {
            const results = await db.all(
                `SELECT * FROM acra_entities 
                 WHERE entity_name LIKE ? 
                    OR uen LIKE ? 
                 LIMIT 100`,
                [`%${query}%`, `%${query}%`]
            );

            if (results.length === 0) {
                return { documents: [], cursor: undefined };
            }

            // Create JSON content
            const jsonResults = results.map(row => ({
                uen: row.uen,
                entity_name: row.entity_name
            }));

            return {
                documents: [],
                records: jsonResults,
                cursor: undefined
            };
        } finally {
            await db.close();
        }
    }
}
