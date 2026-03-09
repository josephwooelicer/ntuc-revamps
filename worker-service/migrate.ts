import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';

async function migrate() {
    const db = await open({
        filename: path.join(__dirname, '../data/ntuc-ews.db'),
        driver: sqlite3.Database
    });

    console.log('Ensuring migrations table exists...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
        fs.mkdirSync(migrationsDir);
    }

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    let appliedCount = 0;
    for (const file of files) {
        const row = await db.get('SELECT filename FROM migrations WHERE filename = ?', file);
        if (!row) {
            console.log(`Applying migration: ${file}`);
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            try {
                // We use executing all statements in the SQL file
                await db.exec(sql);
                await db.run('INSERT INTO migrations (filename) VALUES (?)', file);
                appliedCount++;
            } catch (err) {
                console.error(`Failed to apply migration ${file}:`, err);
                process.exit(1);
            }
        }
    }

    if (appliedCount === 0) {
        console.log('Database is up to date.');
    } else {
        console.log(`Successfully applied ${appliedCount} migration(s).`);
    }

    await db.close();
}

migrate().catch(console.error);
