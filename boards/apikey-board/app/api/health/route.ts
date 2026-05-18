import { jsonOk } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return jsonOk({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}
