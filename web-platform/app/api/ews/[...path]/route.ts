const WORKER_BASE = process.env.WORKER_BASE_URL || `http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT_WORKER || "4000"}`;

async function proxy(request: Request, path: string[], method: string) {
  const url = new URL(request.url);
  const target = new URL(`${WORKER_BASE}/${path.join("/")}`);
  target.search = url.search;

  const headers = new Headers();
  const userId = request.headers.get("x-user-id");
  if (userId) {
    headers.set("x-user-id", userId);
  }
  headers.set("content-type", "application/json");

  const init: RequestInit = { method, headers };
  if (method !== "GET") {
    init.body = await request.text();
  }

  const response = await fetch(target, init);
  const text = await response.text();

  return new Response(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json"
    }
  });
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, path, "GET");
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, path, "POST");
}

export async function PUT(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, path, "PUT");
}
