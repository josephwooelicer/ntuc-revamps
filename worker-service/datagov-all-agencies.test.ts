import { IngestionEngine } from './src/ingestion/engine';
import { DataGovSgConnector } from './src/ingestion/connectors/data-gov-sg';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

const AGENCIES = [
    // 'URA',
    'MOM',
    // 'SINGSTATS',
    // 'SSG', 'WSG', 'STB', 'SLA', 'CUSTOMS', 'OGP',
    // 'NHB', 'MAS', 'MOT', 'MSF', 'MLAW', 'MFA', 'MOF', 'MPA', 'STATECOURTS', 'IMDA',
    // 'IRAS', 'ICA', 'HLB', 'A*STAR', 'CPF', 'CAAS', 'CCCS', 'EDB', 'ENTERPRISESG',
    // 'GovTech'
];

async function ensureSourceSeeded() {
    const dbPath = path.resolve(__dirname, '../data/ntuc-ews.db');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.run(
        `INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['src-data-gov-sg', 'Data.gov.sg', 'government', 'scraping', 'Industry', 1.0, 1, 1]
    );
    await db.close();
}

async function runAllAgencies() {
    await ensureSourceSeeded();

    const engine = new IngestionEngine();
    engine.registerConnector(new DataGovSgConnector());

    const range = {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-02-01T00:00:00Z')
    };

    console.log(`\n[DataGov All-Agencies Test] Starting for ${AGENCIES.length} agencies...\n`);

    const summary: { agency: string; docs: number; error?: string }[] = [];
    const MAX_RETRIES = 2;

    for (const agency of AGENCIES) {
        console.log(`\n--- [${agency}] ---`);
        let lastError: string | undefined;
        let docs = 0;
        let succeeded = false;

        for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
            if (attempt > 1) {
                console.log(`[${agency}] Retrying (attempt ${attempt})...`);
                await new Promise(r => setTimeout(r, 5000));
            }
            try {
                const res = await engine.runBackfill('src-data-gov-sg', range, { agency });
                docs = res.recordsPulled;
                console.log(`[${agency}] ✓ ${docs} documents`);
                succeeded = true;
                break;
            } catch (e: any) {
                lastError = e.message;
                console.error(`[${agency}] ✗ Attempt ${attempt} failed: ${e.message}`);
            }
        }

        summary.push({ agency, docs, error: succeeded ? undefined : lastError });

        // Brief cooldown between agencies to avoid DNS/resource exhaustion
        await new Promise(r => setTimeout(r, 3000));
    }

    console.log('\n========== SUMMARY ==========');
    let total = 0;
    for (const s of summary) {
        const status = s.error ? `✗ ERROR: ${s.error}` : `✓ ${s.docs} docs`;
        console.log(`  ${s.agency.padEnd(16)} ${status}`);
        total += s.docs;
    }
    console.log(`\n  TOTAL: ${total} documents across ${AGENCIES.length} agencies`);
    console.log('=============================\n');
}

runAllAgencies().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
