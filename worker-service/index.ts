import express, { Request, Response } from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { IngestionEngine } from './src/ingestion/engine';
import { normalizeRangeToSgtDayBounds } from './src/ingestion/utils';
import { DataGovSgConnector } from './src/ingestion/connectors/data-gov-sg';
import { NewsGoogleSearchConnector } from './src/ingestion/connectors/news-google-search';
import { LayoffsFyiConnector } from './src/ingestion/connectors/layoffs-fyi';
import { EgazetteConnector } from './src/ingestion/connectors/egazette';
import { AcraBulkSyncConnector, AcraLocalSearchConnector } from './src/ingestion/connectors/acra-bulk-sync';
<<<<<<< HEAD
import { ListedCompanyAnnualReportsConnector } from './src/ingestion/connectors/listed-company-annual-reports';
import { RedditSentimentConnector } from './src/ingestion/connectors/reddit-sentiment';
import { ProcessingEngine } from './src/processing/engine';
=======
>>>>>>> c1e5815 (feat: Remove `ListedCompanyAnnualReportsConnector` along with its documentation and test files.)

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(express.json());
const port = process.env.WORKER_PORT || 4000;

const ingestionEngine = new IngestionEngine();
const processingEngine = new ProcessingEngine();
ingestionEngine.registerConnector(new DataGovSgConnector());
ingestionEngine.registerConnector(new NewsGoogleSearchConnector());
ingestionEngine.registerConnector(new LayoffsFyiConnector());
ingestionEngine.registerConnector(new EgazetteConnector());
ingestionEngine.registerConnector(new AcraBulkSyncConnector());
ingestionEngine.registerConnector(new AcraLocalSearchConnector());
<<<<<<< HEAD
ingestionEngine.registerConnector(new ListedCompanyAnnualReportsConnector());
ingestionEngine.registerConnector(new RedditSentimentConnector());
=======

>>>>>>> c1e5815 (feat: Remove `ListedCompanyAnnualReportsConnector` along with its documentation and test files.)

// Resolve paths relative to root directory
const rootDir = path.resolve(__dirname, '..');
const dataLakePath = path.resolve(rootDir, process.env.DATA_LAKE_PATH || 'data-lake/raw');
const dbPath = path.resolve(rootDir, (process.env.DATABASE_URL || 'file:data/ntuc-ews.db').replace('file:', ''));

app.get('/health', async (req: Request, res: Response) => {
    const checks = {
        database: 'pending',
        dataLake: 'pending'
    };

    let overallStatus = 'ok';

    // Check Database
    try {
        const db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
        await db.get('SELECT 1');
        checks.database = 'ok';
        await db.close();
    } catch (err) {
        checks.database = 'error';
        overallStatus = 'error';
    }

    // Check Data Lake
    if (fs.existsSync(dataLakePath)) {
        checks.dataLake = 'ok';
    } else {
        checks.dataLake = 'error';
        overallStatus = 'error';
    }

    res.status(overallStatus === 'ok' ? 200 : 503).json({
        service: 'worker-service',
        status: overallStatus,
        timestamp: new Date().toISOString(),
        checks
    });
});

app.get('/api/v1/sources', async (req: Request, res: Response) => {
    try {
        const db = await open({ filename: dbPath, driver: sqlite3.Database });
        const sources = await db.all('SELECT * FROM sources');
        await db.close();
        res.json(sources);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/sources', async (req: Request, res: Response) => {
    const { id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill } = req.body;
    try {
        const db = await open({ filename: dbPath, driver: sqlite3.Database });
        await db.run(
            `INSERT INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill ? 1 : 0]
        );
        await db.close();
        res.status(201).json({ status: 'created', id });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/ingestion/backfill/news', async (req: Request, res: Response) => {
    const { sourceId, rangeStart, rangeEnd } = req.body;
    if (!sourceId || !rangeStart || !rangeEnd) {
        return res.status(400).json({ error: 'Missing sourceId, rangeStart, or rangeEnd' });
    }

    try {
        const normalizedRange = normalizeRangeToSgtDayBounds(new Date(rangeStart), new Date(rangeEnd));
        const result = await ingestionEngine.runBackfill(sourceId, {
            start: normalizedRange.start,
            end: normalizedRange.end
        }, req.body);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/ingestion/run', async (req: Request, res: Response) => {
    const { runMode, companyName, uen, industry, rangeStart, rangeEnd, options } = req.body;
    if (!runMode || !rangeStart || !rangeEnd) {
        return res.status(400).json({ error: 'Missing runMode, rangeStart, or rangeEnd' });
    }
    if (runMode !== 'debug_on_demand' && runMode !== 'production') {
        return res.status(400).json({ error: 'runMode must be debug_on_demand or production' });
    }
    if (runMode === 'debug_on_demand' && !companyName && !uen) {
        return res.status(400).json({ error: 'debug_on_demand requires companyName or uen' });
    }

    try {
        const normalizedRange = normalizeRangeToSgtDayBounds(new Date(rangeStart), new Date(rangeEnd));
        const result = await ingestionEngine.runScopedIngestion({
            runMode,
            companyName,
            uen,
            industry,
            range: {
                start: normalizedRange.start,
                end: normalizedRange.end
            },
            options
        });
        return res.json(result);
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/v1/ingestion/run/:runId', async (req: Request, res: Response) => {
    const { runId } = req.params;
    try {
        const db = await open({ filename: dbPath, driver: sqlite3.Database });
        const run = await db.get(
            `SELECT * FROM ingestion_orchestration_run WHERE id = ?`,
            runId
        );
        if (!run) {
            await db.close();
            return res.status(404).json({ error: 'Run not found' });
        }

        const items = await db.all(
            `SELECT * FROM ingestion_orchestration_item
             WHERE orchestration_run_id = ?
             ORDER BY started_at ASC`,
            runId
        );
        await db.close();
        return res.json({ run, items });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/v1/ingestion/runs', async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const runMode = req.query.runMode as string | undefined;
    const companyName = req.query.companyName as string | undefined;
    const limitRaw = req.query.limit as string | undefined;
    const limit = Math.max(1, Math.min(200, Number(limitRaw || 20)));

    const whereParts: string[] = [];
    const params: any[] = [];

    if (status) {
        whereParts.push('r.status = ?');
        params.push(status);
    }
    if (runMode) {
        whereParts.push('r.run_mode = ?');
        params.push(runMode);
    }
    if (companyName) {
        whereParts.push('r.company_name LIKE ?');
        params.push(`%${companyName}%`);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    try {
        const db = await open({ filename: dbPath, driver: sqlite3.Database });
        const runs = await db.all(
            `SELECT r.*,
                    COUNT(i.id) AS connector_count,
                    SUM(CASE WHEN i.status = 'success' THEN 1 ELSE 0 END) AS connectors_succeeded,
                    SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) AS connectors_failed,
                    SUM(CASE WHEN i.status = 'skipped' THEN 1 ELSE 0 END) AS connectors_skipped
             FROM ingestion_orchestration_run r
             LEFT JOIN ingestion_orchestration_item i ON i.orchestration_run_id = r.id
             ${whereClause}
             GROUP BY r.id
             ORDER BY r.started_at DESC
             LIMIT ?`,
            ...params,
            limit
        );
        await db.close();
        return res.json({ runs, limit });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/processing/run', async (req: Request, res: Response) => {
    const { runMode, ingestionOrchestrationRunId, rangeStart, rangeEnd } = req.body;
    if (!runMode) {
        return res.status(400).json({ error: 'Missing runMode' });
    }
    if (runMode !== 'debug_on_demand' && runMode !== 'production') {
        return res.status(400).json({ error: 'runMode must be debug_on_demand or production' });
    }
    if (runMode === 'debug_on_demand' && !ingestionOrchestrationRunId) {
        return res.status(400).json({ error: 'debug_on_demand requires ingestionOrchestrationRunId' });
    }

    try {
        const normalizedRange =
            rangeStart && rangeEnd
                ? normalizeRangeToSgtDayBounds(new Date(rangeStart), new Date(rangeEnd))
                : null;

        const result = await processingEngine.run({
            runMode,
            ingestionOrchestrationRunId,
            rangeStart: normalizedRange?.start,
            rangeEnd: normalizedRange?.end
        });
        return res.json(result);
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Worker service listening at http://localhost:${port}`);
});
