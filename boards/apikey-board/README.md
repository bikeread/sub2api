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
