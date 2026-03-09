import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { spawn, ChildProcess } from 'node:child_process';
import { IngestionEngine } from './src/ingestion/engine';
import { Connector, IngestionRange, IngestionResult, RawDocument } from './src/ingestion/types';
import { normalizeRangeToSgtDayBounds } from './src/ingestion/utils';

const repoRoot = path.resolve(__dirname, '..');
const dbPath = path.resolve(repoRoot, 'data/ntuc-ews.db');
const apiPort = 4102;
const apiBase = `http://127.0.0.1:${apiPort}`;

class FakeConnector implements Connector {
    id: string;
    constructor(id: string) {
        this.id = id;
    }

    async pull(
        _range?: IngestionRange,
        _cursor?: string,
        _options?: Record<string, any>,
        onDocument?: (doc: RawDocument) => Promise<void>,
        onRecord?: (record: any) => Promise<void>
    ): Promise<IngestionResult> {
        const documents: RawDocument[] = [
            {
                id: `${this.id}-doc-1`,
                sourceId: this.id,
                externalId: 'doc-1',
                fetchedAt: new Date().toISOString(),
                title: `Fake document ${this.id}`,
                url: `https://example.com/${this.id}`,
                content: JSON.stringify({ source: this.id }),
                metadata: {
                    filename: `${this.id}.json`,
                    queryText: `query-${this.id}`,
                    filterParams: { source: this.id },
                    retrievalUrl: `https://example.com/retrieve/${this.id}`,
                    pageNumber: 1
                }
            }
        ];
        const records = [
            {
                id: `${this.id}-record-1`,
                externalId: 'record-1',
                payload: { source: this.id },
                queryText: `query-${this.id}`,
                filterParams: { source: this.id },
                retrievalUrl: `https://example.com/retrieve/${this.id}`,
                pageNumber: 1
            }
        ];
        if (onDocument) {
            for (const doc of documents) {
                await onDocument(doc);
            }
        }
        if (onRecord) {
            for (const record of records) {
                await onRecord(record);
            }
        }
        return { documents, records };
    }
}

async function getDb() {
    return open({ filename: dbPath, driver: sqlite3.Database });
}

async function seedSource(id: string, supportsBackfill = 1, isActive = 1) {
    const db = await getDb();
    await db.run(
        `INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, id, 'test', 'test', 'Event', 1.0, supportsBackfill, isActive]
    );
    await db.close();
}

async function clearIngestionTables() {
    const db = await getDb();
    await db.exec(`
      DELETE FROM ingestion_orchestration_item;
      DELETE FROM ingestion_orchestration_run;
      DELETE FROM raw_document;
      DELETE FROM raw_record;
      DELETE FROM ingestion_run;
    `);
    await db.close();
}

let serverProc: ChildProcess | null = null;

async function waitForHealth(url: string, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                return;
            }
        } catch {
            // ignore until ready
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`Timed out waiting for ${url}`);
}

test('Section 6: date-range normalization to SGT day bounds', async () => {
    const normalized = normalizeRangeToSgtDayBounds(
        new Date('2026-03-01T07:12:55.000Z'),
        new Date('2026-03-03T04:00:00.000Z')
    );
    assert.equal(normalized.start.toISOString(), '2026-02-28T16:00:00.000Z');
    assert.equal(normalized.end.toISOString(), '2026-03-03T15:59:59.000Z');
});

test('Section 6: fan-out orchestration runs multiple connectors in one run', async () => {
    await clearIngestionTables();
    await seedSource('test-src-a', 1, 1);
    await seedSource('test-src-b', 1, 1);

    const engine = new IngestionEngine();
    engine.registerConnector(new FakeConnector('test-src-a'));
    engine.registerConnector(new FakeConnector('test-src-b'));

    const result = await engine.runScopedIngestion({
        runMode: 'production',
        range: {
            start: new Date('2026-03-01T00:00:00.000Z'),
            end: new Date('2026-03-01T23:59:59.000Z')
        },
        options: {}
    });

    assert.equal(result.totalConnectors, 2);
    assert.equal(result.connectorsSucceeded, 2);
    assert.equal(result.connectorsFailed, 0);
});

test('Section 6: dedup/idempotent rerun skips duplicates', async () => {
    await clearIngestionTables();
    await seedSource('test-src-dedup', 1, 1);

    const engine = new IngestionEngine();
    engine.registerConnector(new FakeConnector('test-src-dedup'));
    const range = {
        start: new Date('2026-03-01T00:00:00.000Z'),
        end: new Date('2026-03-01T23:59:59.000Z')
    };

    const first = await engine.runBackfill('test-src-dedup', range);
    const second = await engine.runBackfill('test-src-dedup', range);

    assert.equal(first.documentsSaved, 1);
    assert.equal(first.recordsSaved, 1);
    assert.equal(first.duplicatesSkipped, 0);
    assert.equal(second.documentsSaved, 0);
    assert.equal(second.recordsSaved, 0);
    assert.ok(second.duplicatesSkipped >= 2);
});

test('Section 6: API integration for run creation + status lookup', async () => {
    await clearIngestionTables();
    await seedSource('src-acra-data-gov-sg', 1, 1);
    await seedSource('src-news', 1, 0);
    await seedSource('src-egazette', 1, 0);
    await seedSource('src-annual-reports-listed', 1, 0);
    await seedSource('src-reddit-sentiment', 1, 0);
    await seedSource('src-layoffs-fyi', 0, 0);
    await seedSource('src-data-gov-sg', 1, 0);
    await seedSource('src-acra-bulk-sync', 1, 0);

    serverProc = spawn('npm', ['run', 'start'], {
        cwd: path.resolve(repoRoot, 'worker-service'),
        env: { ...process.env, WORKER_PORT: String(apiPort) },
        stdio: 'ignore'
    });
    await waitForHealth(`${apiBase}/health`);

    const runCreateRes = await fetch(`${apiBase}/api/v1/ingestion/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            runMode: 'production',
            rangeStart: '2026-03-01T00:00:00.000Z',
            rangeEnd: '2026-03-01T23:59:59.000Z',
            options: { companyName: 'acme' }
        })
    });
    assert.equal(runCreateRes.status, 200);
    const runCreateBody = await runCreateRes.json() as { orchestrationRunId: string };
    assert.ok(runCreateBody.orchestrationRunId);

    const runGetRes = await fetch(`${apiBase}/api/v1/ingestion/run/${runCreateBody.orchestrationRunId}`);
    assert.equal(runGetRes.status, 200);
    const runGetBody = await runGetRes.json() as { run: { id: string }, items: Array<any> };
    assert.equal(runGetBody.run.id, runCreateBody.orchestrationRunId);
    assert.ok(Array.isArray(runGetBody.items));

    serverProc.kill('SIGTERM');
    serverProc = null;
});

test.after(async () => {
    if (serverProc) {
        serverProc.kill('SIGTERM');
        serverProc = null;
    }
});
