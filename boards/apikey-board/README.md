# API Key Board

独立于 Sub2API 主服务的 API Key 团队大屏。这个服务：

- 使用 Next.js 渲染墙屏风格的大屏页面
- 通过 Sub2API iframe 透传的管理员 token 做只读鉴权
- 通过只读 PostgreSQL 账号直接查询 `users`、`api_keys`、`usage_logs`
- 不改动 Sub2API 主服务镜像，保持官方 `docker pull` 升级路径

## 本地开发

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

默认路径为 `/boards/apikey`。

## 生产部署

```bash
cp .env.example .env
docker compose up -d --build
```

服务默认只监听 `127.0.0.1:3090`，供宿主机上的 `nginx` 反向代理。

## nginx 反向代理示例

```nginx
location ^~ /boards/apikey/ {
    proxy_pass http://127.0.0.1:3090;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
}
```

## Sub2API 后台集成

在 Sub2API 管理后台新增一个 `visibility=admin` 的自定义菜单项：

- Label: `API Key 大屏`
- URL: `https://<your-host>/boards/apikey/`

Sub2API 会在 iframe URL 上透传：

- `token`
- `user_id`
- `theme`
- `lang`
- `ui_mode`

本服务会使用 `token` 调用 `/api/v1/auth/me` 校验管理员身份。

## 只读数据库账号示例

```sql
CREATE USER apikey_board_readonly WITH PASSWORD 'change_me';
GRANT CONNECT ON DATABASE sub2api TO apikey_board_readonly;
GRANT USAGE ON SCHEMA public TO apikey_board_readonly;
GRANT SELECT ON TABLE users, api_keys, usage_logs TO apikey_board_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO apikey_board_readonly;
```

## 注意

- 如果你修改 `BOARD_BASE_PATH`，需要重新构建镜像，因为 Next.js 的 `basePath` 会在构建阶段固化。
- `SUB2API_BASE_URL` 仅用于服务端调用 `/api/v1/auth/me` 校验管理员 token。

## 降智检测（Model Trace）

`/model-trace` 页面提供账号维度的手动降智检测：对每个 OpenAI 账号发送 3 条随机整数挑战，用 [ModelTrace](https://github.com/xqy2006/ModelTrace)（MIT）的统计指纹库归因出实际服务的模型，与声明模型比对判定「正常 / 疑似降智 / 无法判定」。

- 指纹归因实现移植自上游 Python 版本（`lib/modeltrace/`，许可见 `lib/modeltrace/data/MODELTRACE-LICENSE`），与原版有 1e-9 精度的对拍测试（`lib/modeltrace/testdata/attribution.json`）。
- 检测经由 sub2api 网关按账号路由：首次检测某账号时，会用调用者的管理员 token 自动创建 `巡检-<账号名>` 单账号分组和专用 API key（缓存在 `data/modeltrace-state.json`），只追加不改动账号原有分组。
- 检测历史记录在 `data/modeltrace-history.jsonl`。

### 检测方式与结果

- **统计指纹检测**（默认）：保持原有三次挑战与统计归因。模型留空时自动选择账号支持的可归因模型。
- **提示词检测（人工判断）**：预置糖果配对题及完整表格，可编辑、恢复默认。必须选择目标模型并提供非空提示词；允许账号支持的指纹库外模型。按当前内容发送一次请求，不自动重试、不打分、不记录人工结论。
- 单账号与全部检测均可使用两种方式。批量在开始前验证并固定全部配置，按账号串行执行；页面显示进度及各账号错误，可手动重试。
- 两种方式分别显示最近结果。提示词、完整回复、请求模型、耗时、结束原因及时间保存在现有 JSONL 历史中；可复制、展开阅读，并回看所选账号/方式最近 50 次记录。`finishReason=length` 时显示输出截断提示。
- 旧记录无 `method` 时按统计指纹处理；旧记录没有耗时、逐题诊断的字段时显示未记录，不补造信息。

### 接口兼容

`POST /api/model-trace/detect` 沿用管理员 Bearer 鉴权及 `{ ok, data/error }` 响应封装：

```json
{"account_id": 123, "model": "账号支持的模型", "method": "prompt", "prompt": "完整检测提示词"}
```

`method` 可选 `fingerprint` 或 `prompt`，省略时为 `fingerprint`。统计模式仍返回 `entry` 和 `attribution`；人工模式返回 `entry`，包括 `method`、`accountId`、`accountName`、`model`、`prompt`、`output`、`finishReason`、`durationMs` 和 `detectedAt`，不含自动判定字段。

账号接口的 `last` 保持统计结果，新增 `lastPrompt`；历史接口支持 `?account_id=123&method=prompt`，不传方式仍返回混合历史。参数错误返回 400，同账号重复执行返回 409；恢复失败返回错误，不保存成功结论。

### 执行与恢复

同账号互斥覆盖准备、请求、恢复及历史写入，采用当前单容器、单 Node 进程部署中的进程级锁，不支持跨副本互斥。不要将该服务改成多副本并行检测而不补共享锁。

调度关闭的账号在检测期间隔离到巡检分组，准备或请求失败也尝试恢复原调度和分组。若关闭调度失败，不重新挂回原分组，并报告需人工检查的账号；分组恢复失败也明确报错。进程被强制终止时不能保证恢复，应检查涉及账号。巡检通道仍缓存复用，不删除业务数据。

本地验证使用 `pnpm test`、`pnpm typecheck`、`pnpm build`。接口与执行器测试使用模拟响应和临时目录，不调用真实账号。

### 模型与思维强度下拉

所有账号统一读取已同步的 `extra.upstream_model_metadata.models`，不再使用写死的默认模型或强度清单。

- 缺少同步数据时显示提示并禁用检测，需在账号管理中同步模型信息后刷新。
- 统计指纹模式保留指纹库覆盖限制及自动选择；提示词模式使用账号已同步的模型清单。
- 思维强度只显示所选模型的 `supported_reasoning_levels`，保留 `ultra` 和其他上游提供的非空档位。缺少强度信息或模型明确不支持推理时，仅提供“跟随模型默认”。
- 检测开始前重新读取账号的同步数据，验证模型和强度。批量运行固定启动时的配置；无法确认的选项在调用模型前报错。
- `reasoning_effort` 不选时省略；选择时原样传入请求，历史 `reasoningEffort` 记录请求值，不表述为上游实际执行值。
