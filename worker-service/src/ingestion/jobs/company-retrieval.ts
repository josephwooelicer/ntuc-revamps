import { IngestionEngine } from '../engine';
import { DataGovSgConnector } from '../connectors/data-gov-sg';
import { NewsGoogleSearchConnector } from '../connectors/news-google-search';
import { EgazetteConnector } from '../connectors/egazette';
import { RedditSentimentConnector } from '../connectors/reddit-sentiment';
import { IngestionRange } from '../types';
import { fromSGT } from '../utils';

export async function runEpic4Retrieval(targetYear: number, targetMonth: number, companyName: string) {
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

    const summary: any[] = [];

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
        console.log(`[${yearStr}-${monthStr}] Retrieving Company Data for "${companyName}"...`);

        const monthResult = {
            year: yearStr,
            month: monthStr,
            egazette: { status: 'pending', docs: 0, error: '' },
            news: { status: 'pending', docs: 0, error: '' },
            reddit: { status: 'pending', docs: 0, error: '' }
        };

        // Egazette
        try {
            const resEgazette = await engine.runBackfill('src-egazette', range, {
                query: companyName
            });
            monthResult.egazette = { status: 'success', docs: resEgazette.recordsPulled, error: '' };
        } catch (e: any) {
            monthResult.egazette = { status: 'error', docs: 0, error: e.message };
        }

        // News (Google Search)
        try {
            const resNews = await engine.runBackfill('src-news', range, {
                company_name: companyName,
            });
            monthResult.news = { status: 'success', docs: resNews.recordsPulled, error: '' };
        } catch (e: any) {
            monthResult.news = { status: 'error', docs: 0, error: e.message };
        }

        // Reddit (Google Search)
        try {
            const resReddit = await engine.runBackfill('src-reddit-sentiment', range, {
                company_name: companyName
            });
            monthResult.reddit = { status: 'success', docs: resReddit.recordsPulled, error: '' };
        } catch (e: any) {
            monthResult.reddit = { status: 'error', docs: 0, error: e.message };
        }

        summary.push(monthResult);
    }

    console.log(`\nFull retrieval completed for ${companyName}`);
    return {
        companyName,
        targetYear,
        targetMonth,
        summary
    };
}
