import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./store', () => ({ getProbeRoute: vi.fn(), saveProbeRoute: vi.fn() }));
vi.mock('./sub2api-admin', () => ({
  createProbeGroup: vi.fn(),
  createProbeKey: vi.fn(),
  getAccountGroupIds: vi.fn(),
  setAccountGroupIds: vi.fn(),
}));
import { getProbeRoute } from './store';
import * as admin from './sub2api-admin';
import { ensureProbeRoute } from './provision';
const account = {
  id: 1,
  name: 'test',
  platform: 'openai',
  type: 'oauth',
  status: 'active',
};
beforeEach(() => vi.resetAllMocks());
it('reattaches a cached probe group after an earlier isolated inspection restored original groups', async () => {
  const cached = {
    accountId: 1,
    accountName: 'test',
    groupId: 9,
    apiKey: 'fixture',
    createdAt: '',
  };
  vi.mocked(getProbeRoute).mockResolvedValue(cached);
  vi.mocked(admin.getAccountGroupIds).mockResolvedValue([2, 3]);
  expect(await ensureProbeRoute('token', account)).toEqual(cached);
  expect(admin.setAccountGroupIds).toHaveBeenCalledWith('token', 1, [2, 3, 9]);
  expect(admin.createProbeGroup).not.toHaveBeenCalled();
});
it('reports both provisioning and rollback failures', async () => {
  vi.mocked(getProbeRoute).mockResolvedValue(null);
  vi.mocked(admin.createProbeGroup).mockResolvedValue(9);
  vi.mocked(admin.getAccountGroupIds)
    .mockResolvedValueOnce([2])
    .mockResolvedValueOnce([2, 9]);
  vi.mocked(admin.createProbeKey).mockRejectedValue(
    new Error('create key failed'),
  );
  vi.mocked(admin.setAccountGroupIds)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('rollback failed'));
  await expect(ensureProbeRoute('token', account)).rejects.toThrow(
    '巡检通道准备失败：create key failed；巡检分组恢复失败：rollback failed',
  );
});
