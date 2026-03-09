import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

let db: Database | null = null;

export async function getDb() {
    if (db) return db;

    db = await open({
        filename: path.join(process.cwd(), '../data/ntuc-ews.db'),
        driver: sqlite3.Database
    });

    return db;
}
