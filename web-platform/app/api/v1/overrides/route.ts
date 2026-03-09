import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken, hasPermission } from '@/lib/auth';

export async function POST(req: NextRequest) {
    try {
        const token = req.headers.get('Authorization')?.split(' ')[1];
        if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const user = await verifyToken(token);
        if (!user || !hasPermission(user, 'override_company')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { entity_type, entity_id, original_score, overridden_score, reason } = await req.json();
        const db = await getDb();

        await db.run(`
            INSERT INTO overrides (entity_type, entity_id, original_score, overridden_score, actor_user_id, reason)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [entity_type, entity_id, original_score, overridden_score, user.id, reason]);

        // Log audit
        await db.run(`
            INSERT INTO audit_log (action, entity_type, entity_id, old_value, new_value, actor_user_id, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            'CREATE_OVERRIDE',
            entity_type,
            entity_id,
            original_score ? JSON.stringify({ score: original_score }) : null,
            JSON.stringify({ score: overridden_score }),
            user.id,
            reason
        ]);

        return NextResponse.json({ message: 'Override created successfully' });
    } catch (error) {
        console.error('Override error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
