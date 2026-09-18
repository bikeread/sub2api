import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DetectionError, DEFAULT_PROMPT } from './request';
vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
  extractBearerToken: vi.fn(() => 'test-token'),
}));
vi.mock('./sub2api-admin', () => ({ listOpenAIAccounts: vi.fn() }));
vi.mock('./detect', () => ({ detectAccount: vi.fn() }));
import { POST } from '@/app/api/model-trace/detect/route';
import { requireAdmin } from '@/lib/auth';
import { listOpenAIAccounts } from './sub2api-admin';
import { detectAccount } from './detect';
const request = (body: unknown) =>
  new NextRequest('http://localhost/api/model-trace/detect', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    id: 1,
    email: 'test@example.invalid',
    role: 'admin',
  });
  vi.mocked(listOpenAIAccounts).mockResolvedValue([
    {
      id: 1,
      name: 'test',
      type: 'oauth',
      status: 'active',
      platform: 'openai',
    },
  ]);
});
it('rejects unauthenticated requests', async () => {
  vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('UNAUTHORIZED'));
  expect((await POST(request({ account_id: 1 }))).status).toBe(401);
  expect(detectAccount).not.toHaveBeenCalled();
});
it('returns validation errors before provisioning', async () => {
  expect(
    (
      await POST(
        request({ account_id: 1, method: 'prompt', prompt: DEFAULT_PROMPT }),
      )
    ).status,
  ).toBe(400);
  expect(detectAccount).not.toHaveBeenCalled();
});
it('passes the exact prompt and exposes conflict status', async () => {
  vi.mocked(detectAccount).mockRejectedValueOnce(
    new DetectionError('busy', 409),
  );
  expect(
    (
      await POST(
        request({
          account_id: 1,
          model: 'custom',
          method: 'prompt',
          prompt: DEFAULT_PROMPT,
          reasoning_effort: 'high',
        }),
      )
    ).status,
  ).toBe(409);
  expect(detectAccount).toHaveBeenCalledWith(
    'test-token',
    expect.objectContaining({ id: 1 }),
    'custom',
    'prompt',
    DEFAULT_PROMPT,
    'high',
  );
});
