import jwt from 'jsonwebtoken';
import { getDb } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export interface User {
    id: number;
    username: string;
    role: string;
    permissions: string[];
}

export async function verifyToken(token: string): Promise<User | null> {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const db = await getDb();
        const user = await db.get(`
            SELECT u.id, u.username, r.name as role, r.permissions
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE u.id = ?
        `, decoded.id);

        if (!user) return null;

        return {
            id: user.id,
            username: user.username,
            role: user.role,
            permissions: JSON.parse(user.permissions)
        } catch (error) {
            return null;
        }
    }

export function hasPermission(user: User, permission: string): boolean {
        return user.permissions.includes('all') || user.permissions.includes(permission);
    }
