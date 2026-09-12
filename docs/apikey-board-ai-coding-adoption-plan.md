# API Key Board AI Coding Adoption View Plan

## 背景

现有 `/custom/apikey_board` 菜单项实际嵌入的是独立 Next.js 看板服务：

- 菜单项：`Token大屏`
- iframe URL：`https://api.llszone.com:8443/boards/apikey`
- 生产源码位置：`/opt/apikey-board`
- 生产容器：`apikey-board`
- 服务监听：`127.0.0.1:3090`
- 鉴权方式：Sub2API iframe URL 透传管理员 `token`，看板服务调用 Sub2API `/api/v1/auth/me` 校验管理员身份
- 数据库访问：看板服务用只读 PostgreSQL 账号直连 Sub2API 数据库

需求：面向 IT 总监，在现有 Token 大屏中新增一个 `AI Coding 采用` 视图，用于查看 `公司专用` 分组近一个月内 AI Coding 的人员普及率、有效使用率、人员明细、趋势、客户端分布和模型分布。

## 已确认口径

### 受众

受众是 IT 总监，不是 CEO/大老板。页面要突出运营治理价值：

- 谁还没有采用
- 谁只是轻度尝试
- 谁已经有效使用
- 哪些客户端和模型在使用
- 成本和 Token 是否集中或异常

### 分组

线上目标分组实际名称为 `公司专用`，不是 `公司分组`。

线上校验数据：

- `group_id=9`
- `name=公司专用`
- `platform=openai`
- `status=active`

实现不要硬编码 `group_id=9`。默认分组应按 active group name 精确匹配 `公司专用`，找不到时回退到用户已有选择或全部分组。

### 人员识别

已确认该分组是一人一 Key。

因此人员展示名使用 `api_keys.name`，不要使用 `users` 表。当前线上 `公司专用` 分组：

- 有效 Key 数：20
- Key 名称非空：20
- Key 名称唯一：20
- 这些 Key 当前都属于同一个系统用户，所以不能用 `usage_logs.user_id` 作为人员维度

### 时间窗口

`AI Coding 采用` 视图第一版固定使用最近 30 天滚动窗口，按 `Asia/Shanghai` 时区展示。

不复用现有 Token 概览的 `today / 7d` 切换。

### AI Coding 识别规则

主分类规则只使用客户端/入口信号：

- `user_agent` 包含 `codex`
- `user_agent` 包含 `claude code`
- `inbound_endpoint` 是专用 coding endpoint，例如 `/backend-api/codex%`

模型名包含 `codex` 只能作为辅助展示，不作为主分类规则。

原因：线上大量 AI Coding 请求使用 `gpt-5.5` 这类通用模型。按模型名判断会严重低估。

### 采用与有效使用

采用状态分三档：

- `未采用`：最近 30 天 AI Coding 请求数为 0
- `轻度采用`：最近 30 天 AI Coding 请求数 >= 1，但未达到有效使用阈值
- `有效使用`：最近 30 天 AI Coding 请求数 >= 100，或 AI Coding 活跃天数 >= 5

主指标：

- `AI Coding 采用率 = 采用人数 / 总人数`
- `有效使用率 = 有效使用人数 / 总人数`

### 线上数据快照

以下是 2026-07-03 10:08 Asia/Shanghai 左右的只读校验结果，仅用于验收参考，不要写死到代码：

- 总人数：20
- 采用人数：17
- AI Coding 采用率：85.0%
- 有效使用人数：15
- 有效使用率：75.0%
- 未采用人数：3
- 近 30 天总请求：63,344
- AI Coding 请求：62,799，占 99.1%
- 近 30 天总 Token：6.822B
- AI Coding Token：6.800B，占 99.7%
- 近 30 天总成本：6922.06
- AI Coding 成本：6873.08，占 99.3%

## 第一版范围

### 要做

在现有 `Token大屏` 内新增 Tab：

- `Token 概览`
- `AI Coding 采用`

支持 URL 参数直达：

```text
/boards/apikey?view=adoption
```

`AI Coding 采用` 视图内容：

- 汇总指标卡
- 每日采用趋势
- 客户端分布
- 模型 Top 5
- 人员明细表
- 分组筛选
- 默认分组选中 `公司专用`
- 固定最近 30 天滚动窗口

### 不做

第一版不做以下内容：

- CSV 导出
- 自然月切换
- 阈值配置化
- 提醒、标记、人员维护
- 员工账号体系改造
- Sub2API 主后台改造
- 写数据库

## 现有代码结构

生产源码在服务器：

```text
/opt/apikey-board
```

关键文件：

```text
/opt/apikey-board/components/apikey-board.tsx
/opt/apikey-board/lib/queries.ts
/opt/apikey-board/lib/types.ts
/opt/apikey-board/lib/range.ts
/opt/apikey-board/app/api/summary/route.ts
/opt/apikey-board/app/api/ranking/route.ts
/opt/apikey-board/app/api/models/route.ts
/opt/apikey-board/app/api/trend/route.ts
/opt/apikey-board/app/api/groups/route.ts
/opt/apikey-board/app/api/account-quotas/route.ts
```

当前仓库本地 `boards/apikey-board` 只有构建产物和依赖缓存，不是完整源码。实现时应以服务器 `/opt/apikey-board` 为准，或先把该目录同步成可维护源码。

## 数据设计

### 新增类型

建议在 `lib/types.ts` 新增：

```ts
export type BoardView = 'overview' | 'adoption';

export type AdoptionStage = 'not_adopted' | 'light_adoption' | 'effective_use';

export type AdoptionClientType = 'codex_tui' | 'codex_desktop' | 'claude_code' | 'other';

export interface AdoptionSummary {
  totalPeople: number;
  adoptedPeople: number;
  effectivePeople: number;
  notAdoptedPeople: number;
  lightAdoptionPeople: number;
  adoptionRate: number;
  effectiveRate: number;
  codingRequests: number;
  codingTokens: number;
  codingCost: number;
}

export interface AdoptionPersonRow {
  apiKeyId: number;
  personName: string;
  stage: AdoptionStage;
  codingRequests: number;
  codingActiveDays: number;
  codingTokens: number;
  codingCost: number;
  lastCodingAt: string | null;
  primaryClient: AdoptionClientType;
  primaryClientLabel: string;
  primaryModel: string | null;
}

export interface AdoptionTrendPoint {
  day: string;
  adoptedPeople: number;
  effectivePeople: number;
}

export interface AdoptionClientBreakdownRow {
  client: AdoptionClientType;
  label: string;
  people: number;
  requests: number;
}

export interface AdoptionModelBreakdownRow {
  model: string;
  people: number;
  requests: number;
  tokens: number;
}

export interface AdoptionPayload {
  groupId: number | null;
  groupName: string | null;
  timezone: string;
  windowDays: 30;
  startAt: string;
  endAt: string;
  generatedAt: string;
  summary: AdoptionSummary;
  trend: AdoptionTrendPoint[];
  clients: AdoptionClientBreakdownRow[];
  models: AdoptionModelBreakdownRow[];
  people: AdoptionPersonRow[];
}
```

### 新增 API

建议新增：

```text
GET /api/adoption?group_id=<id>
```

行为：

- 需要管理员 token，与现有 API 一致
- `group_id` 可选
- 如果 `group_id` 为空，按全部 active non-deleted API Key 统计
- 第一版固定最近 30 天滚动窗口
- 返回 `AdoptionPayload`

路由文件：

```text
/opt/apikey-board/app/api/adoption/route.ts
```

### SQL 计算建议

建议在 `lib/queries.ts` 中新增 `getAdoption(pool, groupId)`，或单独新增 `lib/adoption.ts`。

核心 CTE 方向：

```sql
WITH bounds AS (
  SELECT
    now() - interval '30 days' AS start_at,
    now() AS end_at
),
key_base AS (
  SELECT
    ak.id,
    ak.name,
    ak.status,
    ak.group_id,
    g.name AS group_name
  FROM api_keys ak
  LEFT JOIN groups g ON g.id = ak.group_id
  WHERE ak.deleted_at IS NULL
    AND ($1::bigint IS NULL OR ak.group_id = $1::bigint)
),
coding_usage AS (
  SELECT
    ul.*,
    CASE
      WHEN lower(coalesce(ul.user_agent, '')) LIKE '%codex%'
        OR lower(coalesce(ul.user_agent, '')) LIKE '%claude%code%'
        OR lower(coalesce(ul.inbound_endpoint, '')) LIKE '/backend-api/codex%'
      THEN true
      ELSE false
    END AS is_ai_coding
  FROM usage_logs ul
  CROSS JOIN bounds b
  WHERE ul.created_at >= b.start_at
    AND ul.created_at < b.end_at
    AND ($1::bigint IS NULL OR ul.group_id = $1::bigint)
),
person_usage AS (
  SELECT
    kb.id AS api_key_id,
    kb.name AS person_name,
    COUNT(cu.*) FILTER (WHERE cu.is_ai_coding) AS coding_requests,
    COUNT(DISTINCT (cu.created_at AT TIME ZONE $2)::date) FILTER (WHERE cu.is_ai_coding) AS coding_active_days,
    COALESCE(SUM(cu.input_tokens + cu.output_tokens + cu.cache_creation_tokens + cu.cache_read_tokens) FILTER (WHERE cu.is_ai_coding), 0) AS coding_tokens,
    COALESCE(SUM(COALESCE(cu.account_stats_cost, cu.total_cost) * COALESCE(cu.account_rate_multiplier, 1)) FILTER (WHERE cu.is_ai_coding), 0) AS coding_cost,
    MAX(cu.created_at) FILTER (WHERE cu.is_ai_coding) AS last_coding_at
  FROM key_base kb
  LEFT JOIN coding_usage cu ON cu.api_key_id = kb.id
  GROUP BY kb.id, kb.name
)
SELECT * FROM person_usage;
```

注意：

- 上面只是主体示意。实际实现要补充趋势、客户端分布、模型分布。
- `effective_use` 判断在 SQL 或 TypeScript 中都可以，但必须集中定义，避免前后不一致。
- 模型分布只统计 `is_ai_coding=true` 的请求。
- 成本使用现有看板口径：`COALESCE(account_stats_cost, total_cost) * COALESCE(account_rate_multiplier, 1)`。

### 客户端归类

建议新增纯函数并覆盖单元测试：

```ts
function classifyAiCodingClient(userAgent: string | null): AdoptionClientType {
  const ua = (userAgent || '').toLowerCase();
  if (ua.includes('codex desktop')) return 'codex_desktop';
  if (ua.includes('codex')) return 'codex_tui';
  if (ua.includes('claude code')) return 'claude_code';
  return 'other';
}
```

展示标签：

- `codex_tui` -> `Codex TUI`
- `codex_desktop` -> `Codex Desktop`
- `claude_code` -> `Claude Code`
- `other` -> `其他`

主要客户端：

- 对每个人按 AI Coding 请求数最多的客户端归类
- 没有 AI Coding 请求的人显示 `-`

主要模型：

- 对每个人按 AI Coding 请求数最多的 `COALESCE(NULLIF(requested_model,''), model, upstream_model)` 计算
- 没有 AI Coding 请求的人显示 `-`

## UI 设计

### 页面入口

在 `components/apikey-board.tsx` 顶部加入 Tab：

- `Token 概览`
- `AI Coding 采用`

URL 参数：

```text
?view=adoption
```

读取规则：

- `view=adoption` 时进入采用视图
- 其他情况默认 `overview`

不要改变现有 Token 概览默认行为。

### 分组默认逻辑

建议分离两个视图的分组状态：

- 现有 Token 概览继续使用当前的 `apikey-board:group-id`
- AI Coding 采用新增 `apikey-board:adoption-group-id`

采用视图初始化：

1. 如果 URL 或 adoption localStorage 已有 group id，使用它
2. 否则从 `/api/groups` 结果中查找 `name === '公司专用'`
3. 找到则默认选中该分组
4. 找不到则回退全部分组

### 采用视图结构

建议布局：

1. 顶部说明
   - 标题：`AI Coding 采用`
   - 说明：`最近 30 天滚动窗口，人员名称来自 API Key 名称。`
   - 阈值：`有效使用：>=100 次 AI Coding 请求，或 >=5 个 AI Coding 活跃天。`

2. 汇总卡
   - `采用率`
   - `有效使用率`
   - `未采用人数`
   - `AI Coding 请求数`
   - `AI Coding Token`
   - `AI Coding 成本`

3. 趋势图
   - 每日采用人数
   - 每日有效使用人数

4. 分布区
   - 客户端拆分：Codex TUI / Codex Desktop / Claude Code / 其他
   - 模型 Top 5

5. 人员明细表
   - 姓名
   - 状态
   - Coding 请求数
   - Coding 活跃天数
   - Coding Token
   - Coding 成本
   - 最近 Coding 使用
   - 主要客户端
   - 主要模型

### 人员表排序

默认按治理优先级：

1. `未采用`
2. `轻度采用`
3. `有效使用`

同一状态内：

- `未采用`：按姓名升序
- `轻度采用`：按 Coding 请求数降序
- `有效使用`：按 Coding 请求数降序

### 文案

中文文案：

- `AI Coding 采用`
- `最近 30 天`
- `采用人数`
- `采用率`
- `有效使用人数`
- `有效使用率`
- `未采用人数`
- `轻度采用`
- `有效使用`
- `主要客户端`
- `主要模型`

英文文案可以同步补齐，但当前页面主要服务中文管理场景。若工作量要控，英文可以先按直译提供。

## 测试计划

在 `/opt/apikey-board` 中执行：

```bash
pnpm test
pnpm typecheck
pnpm build
```

建议新增测试：

- `lib/adoption.test.ts`
  - 采用状态分类
  - 有效使用阈值
  - 客户端归类
  - 人员排序
- 可选：SQL payload mapper 的单元测试

已有脚本：

```json
{
  "build": "next build",
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
}
```

## 验收标准

### 功能验收

- `/boards/apikey?view=adoption` 可以直达 AI Coding 采用视图
- 未带 `view` 时仍默认显示 Token 概览
- AI Coding 采用视图默认选中 `公司专用`
- 分组可切换
- 页面固定显示最近 30 天滚动窗口
- 人员姓名显示真实 `api_keys.name`
- 人员表包含未采用人员，且未采用人员排在表格顶部
- 不提供 CSV 导出
- 不提供阈值配置
- 不写数据库

### 数据验收

在 2026-07-03 的线上数据附近，选择 `公司专用` 时应接近：

- 总人数：20
- 采用人数：17
- 采用率：85.0%
- 有效使用人数：15
- 有效使用率：75.0%
- 未采用人数：3

由于窗口是滚动 30 天，后续数字会随时间变化。验收时应以实时 SQL 复核，而不是固定断言这些数字。

### 非回归验收

- Token 概览原有今日/最近7天切换不受影响
- Token 概览原有分组筛选不受 adoption 默认分组影响
- 现有接口 `/api/summary`、`/api/ranking`、`/api/models`、`/api/trend`、`/api/account-quotas` 正常
- iframe 鉴权仍要求管理员 token

## 部署建议

生产改动前先备份：

```bash
ssh dmit 'cp -a /opt/apikey-board /opt/apikey-board.backup.$(date +%Y%m%d%H%M%S)-before-ai-coding-adoption'
```

在服务器 `/opt/apikey-board` 修改源码后：

```bash
ssh dmit 'cd /opt/apikey-board && pnpm test && pnpm typecheck && pnpm build'
ssh dmit 'cd /opt/apikey-board && docker compose up -d --build'
ssh dmit 'docker ps --format "table {{.Names}}\t{{.Status}}" | grep apikey-board'
ssh dmit 'docker logs --tail 100 apikey-board'
```

上线后用 Sub2API 管理后台打开 `Token大屏`，访问：

```text
https://api.llszone.com:8443/boards/apikey?view=adoption
```

## 实现拆分建议

建议 opencode 按以下顺序实现：

1. 新增 adoption 领域纯函数和类型
   - 状态分类
   - 客户端归类
   - 排序
   - 单元测试

2. 新增只读查询和 API
   - `getAdoption`
   - `/api/adoption`
   - 本地用 SQL 对照线上聚合结果

3. 接入前端数据加载
   - `BoardData` 增加 adoption 或单独 `useAdoptionData`
   - `view=adoption` 参数解析
   - adoption 独立 group storage

4. 实现 UI
   - Tab
   - 汇总卡
   - 趋势图
   - 客户端/模型分布
   - 人员表

5. 验证和部署
   - `pnpm test`
   - `pnpm typecheck`
   - `pnpm build`
   - Docker rebuild
   - 浏览器人工验收

## 注意事项

- 不要把 `group_id=9` 写死到代码。
- 不要把 2026-07-03 的统计结果写死到代码。
- 不要把模型名包含 `codex` 作为主分类规则。
- 不要用 `users` 表作为人员维度。
- 不要改变 Token 概览默认分组行为。
- 不要在看板服务里写数据库。
- 不要在文档或日志中输出数据库密码、JWT secret、管理员密码。
