import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

async function logAudit(action: string, entityType: string, entityId: string, oldValue: any, newValue: any, actorUserId: string, reason: string) {
    const db = await open({
        filename: path.join(__dirname, '../dev.db'),
        driver: sqlite3.Database
    });

    try {
        await db.run(`
            INSERT INTO audit_log (action, entity_type, entity_id, old_value, new_value, actor_user_id, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            action,
            entityType,
            entityId,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            actorUserId,
            reason
        ]);
        console.log(`Audit log created: ${action} on ${entityType}:${entityId}`);
    } catch (error) {
        console.error('Failed to log audit:', error);
    } finally {
        await db.close();
    }
}

export { logAudit };
