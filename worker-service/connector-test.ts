import { IngestionEngine } from './src/ingestion/engine';
import { DataGovSgConnector } from './src/ingestion/connectors/data-gov-sg';
import { NewsGoogleSearchConnector } from './src/ingestion/connectors/news-google-search';
import { LayoffsFyiConnector } from './src/ingestion/connectors/layoffs-fyi';
import { EgazetteConnector } from './src/ingestion/connectors/egazette';
import { AcraBulkSyncConnector, AcraLocalSearchConnector } from './src/ingestion/connectors/acra-bulk-sync';
import { RedditSentimentConnector } from './src/ingestion/connectors/reddit-sentiment';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';

async function ensureBizfileSourceSeeded() {
    const dbPath = path.resolve(__dirname, '../data/ntuc-ews.db');
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.run(
        `INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['src-acra-bulk-sync', 'ACRA Bulk Sync', 'registry', 'api', 'Company Financial', 1.0, 1, 1]
    );
    await db.run(
        `INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['src-acra-data-gov-sg', 'ACRA Local Search', 'registry', 'database', 'Company Financial', 1.0, 1, 1]
    );
    await db.run(
        `INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['src-news', 'Google News Search', 'news', 'scraping', 'News', 0.8, 1, 1]
    );
    await db.run(
        `INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['src-reddit-sentiment', 'Reddit Sentiment', 'news', 'scraping', 'Social Media', 0.8, 1, 1]
    );
    await db.close();
}

async function test() {
    await ensureBizfileSourceSeeded();

    const engine = new IngestionEngine();
    engine.registerConnector(new DataGovSgConnector());
    engine.registerConnector(new NewsGoogleSearchConnector());
    engine.registerConnector(new LayoffsFyiConnector());
    engine.registerConnector(new EgazetteConnector());
    engine.registerConnector(new AcraBulkSyncConnector());
    engine.registerConnector(new AcraLocalSearchConnector());
    engine.registerConnector(new RedditSentimentConnector());


    // console.log('Testing Layoffs.fyi Connector (Singapore)...');
    // try {
    //     const res5 = await engine.runBackfill('src-layoffs-fyi', range, {
    //         country: 'Singapore'
    //     });
    //     console.log(`Layoffs.fyi Singapore Result: ${res5.recordsPulled} records pulled (runId: ${res5.runId})`);
    // } catch (e) {
    //     console.error('Layoffs.fyi Error:', e);
    // }

    // console.log('Running ACRA Bulk Sync...');
    // try {
    //     await engine.runBackfill('src-acra-bulk-sync', range);
    //     console.log('ACRA Bulk Sync Completed.');
    // } catch (e) {
    //     console.error('ACRA Bulk Sync Error:', e);
    // }

    // console.log('Testing ACRA Local Search (lazada)...');
    // try {
    //     const resLocalSearch = await engine.runBackfill('src-acra-data-gov-sg', range, {
    //         companyName: 'lazada'
    //     });
    //     console.log(`ACRA Local Search Result: ${resLocalSearch.recordsPulled} records pulled (runId: ${resLocalSearch.runId})`);

    //     if (resLocalSearch.records && resLocalSearch.records.length > 0) {
    //         console.log('Returned JSON Result:');
    //         console.log(JSON.stringify(resLocalSearch.records, null, 2));
    //     }
    // } catch (e) {
    //     console.error('ACRA Local Search Error:', e);
    // }

    // console.log('Testing News Google Search (lazada)...');
    // try {
    //     const range = {
    //         start: new Date('2025-10-01T00:00:00Z'),
    //         end: new Date('2025-11-01T00:00:00Z')
    //     };
    //     const resNews = await engine.runBackfill('src-news', range, {
    //         company_name: 'lazada',
    //         news_site: 'straitstimes.com'
    //     });
    //     console.log(`News Google Search Result: ${resNews.recordsPulled} documents found (runId: ${resNews.runId})`);
    // } catch (e) {
    //     console.error('News Google Search Error:', e);
    // }

    // console.log('Testing Reddit Sentiment (lazada)...');
    // try {
    //     const range = {
    //         start: new Date('2025-10-01T00:00:00Z'),
    //         end: new Date('2025-11-01T00:00:00Z')
    //     };
    //     const resReddit = await engine.runBackfill('src-reddit-sentiment', range, {
    //         company_name: 'lazada'
    //     });
    //     console.log(`Reddit Sentiment Result: ${resReddit.recordsPulled} documents found (runId: ${resReddit.runId})`);
    // } catch (e) {
    //     console.error('Reddit Sentiment Error:', e);
    // }

    // console.log('Testing Data.gov.sg (MOM)...');
    // try {
    //     const resDataGov = await engine.runBackfill('src-data-gov-sg', {
    //         start: new Date('2026-01-01T00:00:00Z'),
    //         end: new Date('2026-02-01T00:00:00Z')
    //     }, {
    //         agency: 'NEA',
    //     });
    //     console.log(`Data.gov.sg Result: ${resDataGov.recordsPulled} documents found (runId: ${resDataGov.runId})`);
    // } catch (e) {
    //     console.error('Data.gov.sg Error:', e);
    // }

    // console.log('Testing Egazette (Singapore Airlines)...');
    // try {
    //     const resEgazette = await engine.runBackfill('src-egazette', {
    //         start: new Date('2026-02-01T00:00:00Z'),
    //         end: new Date('2026-03-01T00:00:00Z')
    //     }, {
    //         query: 'twelve cupcakes'
    //     });
    //     console.log(`Egazette Result: ${resEgazette.recordsPulled} documents found (runId: ${resEgazette.runId})`);
    // } catch (e) {
    //     console.error('Egazette Error:', e);
    // }
}

test();
