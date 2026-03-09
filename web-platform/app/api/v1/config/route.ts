import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken, hasPermission } from '@/lib/auth';

export async function GET(req: NextRequest) {
    try {
        const db = await getDb();
        const config = await db.all('SELECT * FROM config');
        return NextResponse.json({ config });
    } catch (error) {
        console.error('Config fetch error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const token = req.headers.get('Authorization')?.split(' ')[1];
        if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const user = await verifyToken(token);
        if (!user || (!hasPermission(user, 'config_industry') && !hasPermission(user, 'config_company'))) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { key, value, reason } = await req.json();
        const db = await getDb();

        const oldConfig = await db.get('SELECT value FROM config WHERE key = ?', key);

        await db.run('UPDATE config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?', [value, key]);

        // Log audit
        await db.run(`
            INSERT INTO audit_log (action, entity_type, entity_id, old_value, new_value, actor_user_id, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            'UPDATE_CONFIG',
            'config',
            key,
            oldConfig ? JSON.stringify({ value: oldConfig.value }) : null,
            JSON.stringify({ value }),
            user.id,
            reason
        ]);

        return NextResponse.json({ message: 'Config updated successfully' });
    } catch (error) {
        console.error('Config update error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
