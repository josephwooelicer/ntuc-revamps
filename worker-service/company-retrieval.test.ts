import { IngestionEngine } from './src/ingestion/engine';
import { DataGovSgConnector } from './src/ingestion/connectors/data-gov-sg';
import { NewsGoogleSearchConnector } from './src/ingestion/connectors/news-google-search';
import { EgazetteConnector } from './src/ingestion/connectors/egazette';
import { RedditSentimentConnector } from './src/ingestion/connectors/reddit-sentiment';
import { IngestionRange } from './src/ingestion/types';
import path from 'path';
import { fromSGT } from './src/ingestion/utils';

/**
 * Raw Data Retrieval Test
 * 
 * This script performs a full retrieval of raw data for a target company and period.
 * It gathers data from 6 months prior to the target month, month-by-month.
 * 
 * 1. Industry data & macroeconomics using data.gov.sg (all agencies).
 * 2. Company data using Egazette, News, and Reddit connectors.
 */

async function runEpic4Retrieval(targetYear: number, targetMonth: number, companyName: string) {
    console.log(`Starting retrieval for ${companyName} checking ${targetYear}-${targetMonth.toString().padStart(2, '0')}`);

    const engine = new IngestionEngine();
    engine.registerConnector(new DataGovSgConnector());
    engine.registerConnector(new NewsGoogleSearchConnector());
    engine.registerConnector(new EgazetteConnector());
    engine.registerConnector(new RedditSentimentConnector());

    // Generate month-by-month ranges for the previous 6 months using SGT
    const months: { year: number, month: number }[] = [];
    for (let i = 6; i >= 1; i--) {
        // Create SGT date for the first day of the target month, then subtract i months
        const d = new Date(Date.UTC(targetYear, targetMonth - 1 - i, 1));
        months.push({
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1
        });
    }

    console.log(`Calculated 6-month range: ${months[0].year}-${months[0].month} to ${months[5].year}-${months[5].month}`);

    for (const m of months) {
        const monthStr = m.month.toString().padStart(2, '0');
        const yearStr = m.year.toString();

        // Boundaries in SGT
        const firstDay = fromSGT(m.year, m.month, 1, 0, 0, 0);
        const lastDay = fromSGT(m.year, m.month + 1, 1, 0, 0, 0);

        const range: IngestionRange = {
            start: firstDay,
            end: lastDay
        };

        console.log(`\n--- Processing ${yearStr}-${monthStr} ---`);

        // 2. Company Data (Egazette, News, Reddit)
        console.log(`[${yearStr}-${monthStr}] Retrieving Company Data for "${companyName}"...`);

        // Egazette
        try {
            const resEgazette = await engine.runBackfill('src-egazette', range, {
                query: companyName
            });
            console.log(`  - Egazette: ${resEgazette.recordsPulled} documents`);
        } catch (e: any) {
            console.error(`  - Egazette Error: ${e.message}`);
        }

        // News (Google Search)
        try {
            const resNews = await engine.runBackfill('src-news', range, {
                company_name: companyName,
            });
            console.log(`  - News: ${resNews.recordsPulled} documents`);
        } catch (e: any) {
            console.error(`  - News Error: ${e.message}`);
        }

        // Reddit (Google Search)
        try {
            const resReddit = await engine.runBackfill('src-reddit-sentiment', range, {
                company_name: companyName
            });
            console.log(`  - Reddit: ${resReddit.recordsPulled} documents`);
        } catch (e: any) {
            console.error(`  - Reddit Error: ${e.message}`);
        }
    }

    console.log(`\nFull retrieval completed for ${companyName}`);
}

function getMonthName(m: number): string {
    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return monthNames[m - 1];
}

// Execution
const targetMonthYm = process.argv[2] || '2025-08';
const companyToSearch = process.argv[3] || 'agoda';

const [tYear, tMonth] = targetMonthYm.split('-').map(Number);

if (!tYear || !tMonth) {
    console.error('Invalid target month format. Use YYYY-MM (e.g., 2026-01)');
    process.exit(1);
}

runEpic4Retrieval(tYear, tMonth, companyToSearch).catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
