import express, { Request, Response } from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { IngestionEngine } from './src/ingestion/engine';
import { DataGovSgConnector } from './src/ingestion/connectors/data-gov-sg';
import { NewsGoogleSearchConnector } from './src/ingestion/connectors/news-google-search';
import { LayoffsFyiConnector } from './src/ingestion/connectors/layoffs-fyi';
import { EgazetteConnector } from './src/ingestion/connectors/egazette';
import { AcraBulkSyncConnector, AcraLocalSearchConnector } from './src/ingestion/connectors/acra-bulk-sync';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(express.json());
const port = process.env.WORKER_PORT || 4000;

const ingestionEngine = new IngestionEngine();
ingestionEngine.registerConnector(new DataGovSgConnector());
ingestionEngine.registerConnector(new NewsGoogleSearchConnector());
ingestionEngine.registerConnector(new LayoffsFyiConnector());
ingestionEngine.registerConnector(new EgazetteConnector());
ingestionEngine.registerConnector(new AcraBulkSyncConnector());
ingestionEngine.registerConnector(new AcraLocalSearchConnector());

// Resolve paths relative to root directory
const rootDir = path.resolve(__dirname, '..');
const dataLakePath = path.resolve(rootDir, process.env.DATA_LAKE_PATH || 'data-lake/raw');
const dbPath = path.resolve(rootDir, (process.env.DATABASE_URL || 'file:dev.db').replace('file:', ''));

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
        const result = await ingestionEngine.runBackfill(sourceId, {
            start: new Date(rangeStart),
            end: new Date(rangeEnd)
        }, req.body);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Worker service listening at http://localhost:${port}`);
});
