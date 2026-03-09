import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

const dbPath = path.resolve(__dirname, '../../data/ntuc-ews.db');

async function seed() {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    const sources = [
        {
            id: 'src-data-gov-sg',
            name: 'Data.gov.sg Government Datasets',
            sourceType: 'gov_api',
            accessMode: 'api',
            category: 'Macroeconomic',
            reliabilityWeight: 1.0,
            supportsBackfill: 1,
            isActive: 1
        },
        {
            id: 'src-news',
            name: 'Mainstream News',
            sourceType: 'news',
            accessMode: 'scrape',
            category: 'Event',
            reliabilityWeight: 0.8,
            supportsBackfill: 1,
            isActive: 1
        },
        {
            id: 'src-layoffs-fyi',
            name: 'Layoffs.fyi (Tech)',
            sourceType: 'tracker',
            accessMode: 'scrape',
            category: 'Event',
            reliabilityWeight: 0.9,
            supportsBackfill: 0,
            isActive: 1
        },
        {
            id: 'src-acra-bizfile',
            name: 'ACRA BizFile Entity Search',
            sourceType: 'registry',
            accessMode: 'scrape',
            category: 'Company Financial',
            reliabilityWeight: 1.0,
            supportsBackfill: 1,
            isActive: 1
        },
        {
            id: 'src-egazette',
            name: 'eGazette Liquidations',
            sourceType: 'registry',
            accessMode: 'scrape',
            category: 'Event',
            reliabilityWeight: 1.0,
            supportsBackfill: 1,
            isActive: 1
        },
        {
            id: 'src-annual-reports-listed',
            name: 'Listed Company Annual Reports',
            sourceType: 'filing',
            accessMode: 'scrape',
            category: 'Company Financial',
            reliabilityWeight: 0.9,
            supportsBackfill: 1,
            isActive: 1
        }
    ];

    for (const s of sources) {
        await db.run(
            `INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [s.id, s.name, s.sourceType, s.accessMode, s.category, s.reliabilityWeight, s.supportsBackfill, s.isActive]
        );
    }

    console.log('Sources seeded successfully.');
    await db.close();
}

seed().catch(console.error);
