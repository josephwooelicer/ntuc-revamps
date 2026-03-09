import { IngestionEngine } from '../engine';
import { DataGovSgConnector } from '../connectors/data-gov-sg';

const AGENCIES = [
    'URA', 'MOM', 'SINGSTAT',
    'SSG', 'WSG', 'STB', 'SLA', 'CUSTOMS', 'OGP',
    'NHB', 'MAS', 'MOT', 'MSF', 'MLAW', 'MFA', 'MOF', 'MPA', 'STATECOURTS', 'IMDA',
    'IRAS', 'ICA', 'HLB', 'A*STAR', 'CPF', 'CAAS', 'CCCS', 'EDB', 'ENTERPRISESG',
    'GovTech'
];

export async function runDatagovAllAgencies(startMonth: number, startYear: number, endMonth: number, endYear: number) {
    const engine = new IngestionEngine();
    engine.registerConnector(new DataGovSgConnector());

    const startDate = new Date(Date.UTC(startYear, startMonth - 1, 1));
    const endDate = new Date(Date.UTC(endYear, endMonth - 1, 1));

    const range = {
        start: startDate,
        end: endDate
    };

    console.log(`\n[DataGov All-Agencies Job] Starting for ${AGENCIES.length} agencies...\n`);

    const summary: { agency: string; docs: number; error?: string }[] = [];
    const MAX_RETRIES = 3;

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

    let total = 0;
    for (const s of summary) {
        total += s.docs;
    }

    return {
        summary,
        totalDocs: total,
        agenciesProcessed: AGENCIES.length
    };
}
