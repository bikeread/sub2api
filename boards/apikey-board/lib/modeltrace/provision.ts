// 全自动开通巡检通道：为指定账号确保存在「单账号巡检分组 + 专用 key」。
// 使用调用方（当前管理员）的 token 调 admin API；只追加、不删除账号原有分组；
// 状态缓存在 data/modeltrace-state.json。

import {
  createProbeGroup,
  createProbeKey,
  getAccountGroupIds,
  setAccountGroupIds,
  type AdminAccount,
} from './sub2api-admin';
import { getProbeRoute, saveProbeRoute, type ProbeRoute } from './store';

const GROUP_PREFIX = '巡检-';

export async function ensureProbeRoute(
  token: string,
  account: AdminAccount,
): Promise<ProbeRoute> {
  const cached = await getProbeRoute(account.id);
  if (cached) {
    // A previous isolated inspection restores the exact original groups.
    // Reattach the cached probe group when an account is tested again.
    const existing = await getAccountGroupIds(token, account.id);
    if (!existing.includes(cached.groupId)) {
      await setAccountGroupIds(token, account.id, [
        ...existing,
        cached.groupId,
      ]);
    }
    return cached;
  }

  const groupId = await createProbeGroup(
    token,
    `${GROUP_PREFIX}${account.name}`.slice(0, 60),
  );
  try {
    // 先读后写：保留账号原有分组，仅追加巡检组
    const existing = await getAccountGroupIds(token, account.id);
    if (!existing.includes(groupId)) {
      await setAccountGroupIds(token, account.id, [...existing, groupId]);
    }
    const apiKey = await createProbeKey(
      token,
      `modeltrace-${account.id}`.slice(0, 60),
      groupId,
    );
    const route: ProbeRoute = {
      accountId: account.id,
      accountName: account.name,
      groupId,
      apiKey,
      createdAt: new Date().toISOString(),
    };
    await saveProbeRoute(route);
    return route;
  } catch (error) {
    // 半成品处理：分组已建但后续失败时，尝试把账号分组恢复原状
    try {
      const current = await getAccountGroupIds(token, account.id);
      if (current.includes(groupId)) {
        await setAccountGroupIds(
          token,
          account.id,
          current.filter((id) => id !== groupId),
        );
      }
    } catch (recoveryError) {
      const detail =
        recoveryError instanceof Error
          ? recoveryError.message
          : String(recoveryError);
      const original = error instanceof Error ? error.message : String(error);
      throw new Error(
        `巡检通道准备失败：${original}；巡检分组恢复失败：${detail}`,
      );
    }
    throw error;
  }
}
