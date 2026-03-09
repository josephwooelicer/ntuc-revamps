import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Protect API routes under /api/v1/overrides and /api/v1/config
    if (pathname.startsWith('/api/v1/overrides') || (pathname.startsWith('/api/v1/config') && request.method === 'POST')) {
        const authHeader = request.headers.get('Authorization');
        const token = authHeader?.split(' ')[1];

        if (!token) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        // Verification deferred to route handlers due to Edge Runtime limitations with 'jsonwebtoken'
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/api/v1/:path*'],
};
