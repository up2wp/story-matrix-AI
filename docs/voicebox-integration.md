# VoiceBox 接入配置手册

本文档说明如何把 Story Matrix AI 接入 VoiceBox，尤其是生产环境中常见的「VoiceBox 在内网运行，通过 nginx 暴露线上域名，并在 nginx 层配置认证」的部署方式。

按本文完成后，用户可以在 Story Matrix AI 的「管理后台 → Voicebox」中检查连接、读取 voice profiles、上传参考音频、生成章节音频，并且浏览器不会直接访问 VoiceBox，也不会持有 VoiceBox 鉴权凭据。

## 架构关系

推荐生产架构：

```text
浏览器
  │
  │  只访问 Story Matrix AI 自己的 /api/voicebox/*
  ▼
Story Matrix AI 后端
  │
  │  注入 VoiceBox 鉴权 Header
  ▼
nginx: https://voicebox.example.com
  │
  │  校验鉴权，反向代理到内网 VoiceBox
  ▼
VoiceBox: http://127.0.0.1:17493 或 http://voicebox:17493
```

关键点：

- Story Matrix AI 前端只调用同源接口 `/api/voicebox/*`。
- Story Matrix AI 后端从系统配置读取 VoiceBox 服务地址和鉴权方式。
- Story Matrix AI 后端把请求转发到 nginx 暴露的 VoiceBox 地址。
- nginx 校验 Story Matrix AI 后端带来的鉴权 Header。
- VoiceBox 原始服务可以只监听本机或内网，不需要直接暴露给浏览器。

## 支持的 VoiceBox 接口

Story Matrix AI 当前会通过后端代理访问以下 VoiceBox 路径：

| 用途 | VoiceBox 路径 |
|------|---------------|
| 健康检查 | `GET /health` |
| 读取音色 | `GET /profiles` |
| 创建音色 | `POST /profiles` |
| 读取预设音色 | `GET /profiles/presets/{engine}` |
| 读取音色样本 | `GET /profiles/{profile_id}/samples` |
| 上传参考音频 | `POST /profiles/{profile_id}/samples` |
| 发起语音生成 | `POST /generate` |
| 查询生成状态 | `GET /generate/{generation_id}/status` |
| 获取生成音频 | `GET /audio/{generation_id}` |
| 获取样本音频 | `GET /samples/{sample_id}` |

因此 nginx 代理必须允许这些路径、这些 HTTP 方法，以及较大的音频上传和音频下载响应。

## 前置条件

### 1. VoiceBox 服务可在服务器本机或内网访问

先确认部署 nginx 的机器能访问 VoiceBox：

```bash
curl http://127.0.0.1:17493/health
curl http://127.0.0.1:17493/profiles
```

如果 VoiceBox 在 Docker 网络中，地址可能是：

```bash
curl http://voicebox:17493/health
```

### 2. 准备一个线上域名

示例域名：

```text
voicebox.example.com
```

DNS 需要指向 nginx 所在服务器。

### 3. 准备一个给 Story Matrix AI 使用的密钥

示例：

```text
VOICEBOX_PROXY_TOKEN=change-this-to-a-long-random-secret
```

生产环境请使用足够长的随机字符串，不要使用本文示例值。

## nginx 推荐配置：Bearer Token 鉴权

这是最推荐的方式。Story Matrix AI 后端配置 `Bearer Token`，nginx 校验 `Authorization: Bearer ...`。

### nginx server 配置

将以下内容放入 nginx 站点配置，例如：

```text
/etc/nginx/sites-available/voicebox.conf
```

```nginx
server {
    listen 443 ssl http2;
    server_name voicebox.example.com;

    ssl_certificate /etc/letsencrypt/live/voicebox.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/voicebox.example.com/privkey.pem;

    client_max_body_size 200m;

    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_connect_timeout 30s;

    set $voicebox_token "change-this-to-a-long-random-secret";

    if ($http_authorization != "Bearer $voicebox_token") {
        return 401;
    }

    location / {
        proxy_pass http://127.0.0.1:17493;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_request_buffering off;
    }
}

server {
    listen 80;
    server_name voicebox.example.com;
    return 301 https://$host$request_uri;
}
```

如果 VoiceBox 不在本机，而在 Docker Compose 网络或内网机器上，把 `proxy_pass` 改成实际地址：

```nginx
proxy_pass http://voicebox:17493;
```

或：

```nginx
proxy_pass http://10.0.0.23:17493;
```

### 启用配置并重载 nginx

```bash
sudo ln -s /etc/nginx/sites-available/voicebox.conf /etc/nginx/sites-enabled/voicebox.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 从服务器测试 nginx 鉴权

未带鉴权时应返回 `401`：

```bash
curl -i https://voicebox.example.com/health
```

带正确 Bearer Token 时应返回 VoiceBox 健康状态：

```bash
curl -i https://voicebox.example.com/health \
  -H 'Authorization: Bearer change-this-to-a-long-random-secret'
```

读取 profiles：

```bash
curl -i https://voicebox.example.com/profiles \
  -H 'Authorization: Bearer change-this-to-a-long-random-secret'
```

## nginx 可选配置：X-API-Key 鉴权

如果你更希望使用 `X-API-Key`，nginx 可这样配置：

```nginx
server {
    listen 443 ssl http2;
    server_name voicebox.example.com;

    ssl_certificate /etc/letsencrypt/live/voicebox.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/voicebox.example.com/privkey.pem;

    client_max_body_size 200m;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    set $voicebox_api_key "change-this-to-a-long-random-secret";

    if ($http_x_api_key != $voicebox_api_key) {
        return 401;
    }

    location / {
        proxy_pass http://127.0.0.1:17493;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_request_buffering off;
    }
}
```

测试：

```bash
curl -i https://voicebox.example.com/health \
  -H 'X-API-Key: change-this-to-a-long-random-secret'
```

## nginx 可选配置：自定义 Header 鉴权

如果你希望使用自定义 Header，例如 `X-Voicebox-Key`：

```nginx
server {
    listen 443 ssl http2;
    server_name voicebox.example.com;

    ssl_certificate /etc/letsencrypt/live/voicebox.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/voicebox.example.com/privkey.pem;

    client_max_body_size 200m;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    set $voicebox_key "change-this-to-a-long-random-secret";

    if ($http_x_voicebox_key != $voicebox_key) {
        return 401;
    }

    location / {
        proxy_pass http://127.0.0.1:17493;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_request_buffering off;
    }
}
```

测试：

```bash
curl -i https://voicebox.example.com/health \
  -H 'X-Voicebox-Key: change-this-to-a-long-random-secret'
```

## Story Matrix AI 中的配置

登录 Story Matrix AI 后，进入：

```text
管理后台 → Voicebox
```

### 使用 Bearer Token 时

| 字段 | 填写 |
|------|------|
| 服务地址 | `https://voicebox.example.com` |
| 鉴权方式 | `Bearer Token` |
| Bearer Token | `change-this-to-a-long-random-secret` |
| 默认引擎 | `f5-tts` |
| 默认语言 | `zh` |
| 分块 | 开启 |
| 归一化 | 开启 |
| 交叉淡化 | `0.15` |

点击 **保存配置**，然后点击 **检查连接 / 刷新音色**。

### 使用 X-API-Key 时

| 字段 | 填写 |
|------|------|
| 服务地址 | `https://voicebox.example.com` |
| 鉴权方式 | `X-API-Key` |
| API Key | `change-this-to-a-long-random-secret` |

Story Matrix AI 后端会向 VoiceBox 请求自动添加：

```http
X-API-Key: change-this-to-a-long-random-secret
```

### 使用自定义 Header 时

| 字段 | 填写 |
|------|------|
| 服务地址 | `https://voicebox.example.com` |
| 鉴权方式 | `自定义 Header` |
| Header 名称 | `X-Voicebox-Key` |
| Header 值 | `change-this-to-a-long-random-secret` |

Story Matrix AI 后端会向 VoiceBox 请求自动添加：

```http
X-Voicebox-Key: change-this-to-a-long-random-secret
```

## 配置完成后的功能验证

### 1. 在 Story Matrix AI 后台检查连接

进入 **管理后台 → Voicebox**，点击：

```text
检查连接 / 刷新音色
```

预期结果：

```text
Voicebox 连接正常，读取到 N 个音色
```

如果这里失败，先看本文后面的排障部分。

### 2. 在全文预览中绑定音色

进入：

```text
全文预览 → 有声读物 → 绑定旁白和角色音色
```

验证：

- 可以刷新并选择 VoiceBox 中已有 profile。
- 可以给旁白选择 profile。
- 可以给角色选择 profile。

### 3. 上传参考音频

在角色音色卡中：

1. 选择参考音频文件。
2. 填写参考音频对应文本。
3. 点击 **上传到 Voicebox**。

预期：

- Story Matrix AI 不保存音频文件。
- 音频通过后端代理提交到 VoiceBox 的 `POST /profiles/{profile_id}/samples`。
- nginx 需要允许较大的请求体，否则会出现 `413 Request Entity Too Large`。

### 4. 生成章节音频

进入：

```text
全文预览 → 有声读物 → 章节分段与生成
```

流程：

1. 选择已有正文的章节。
2. 点击 **AI 分段**。
3. 检查并编辑分段表中的 speaker、文本、语音提示词。
4. 点击 **生成章节音频**。
5. 生成完成后在线播放或下载章节清单。

## CORS 是否需要配置

一般不需要给 VoiceBox 配 CORS。

原因：浏览器只访问 Story Matrix AI，实际访问 VoiceBox 的是 Story Matrix AI 后端。只要 Story Matrix AI 后端能访问 `https://voicebox.example.com`，浏览器不需要跨域访问 VoiceBox。

只有当你绕开 Story Matrix AI、让浏览器直接访问 VoiceBox 时，才需要考虑 VoiceBox/nginx 的 CORS。但这不是推荐架构。

## TLS 和证书建议

生产环境建议：

- VoiceBox nginx 域名使用 HTTPS。
- 证书使用 Let's Encrypt 或其他可信 CA。
- Story Matrix AI 后端访问的 `服务地址` 填 `https://voicebox.example.com`。
- 不建议在生产环境使用自签证书；Node.js 默认不会信任自签证书，会导致后端代理请求失败。

## 安全建议

- 不要把 VoiceBox 原始端口 `17493` 暴露到公网。
- 不要把 VoiceBox token/API key 写进前端代码。
- 不要把 nginx 认证密钥提交到 Git。
- 生产环境至少启用 Bearer Token、`X-API-Key` 或自定义 Header 之一。
- 如果 VoiceBox 只能内网访问，仍建议 nginx 加认证，避免同内网其他服务误用。
- 密钥泄露后，应同时更换 nginx 配置和 Story Matrix AI 管理后台中的配置。

## 常见问题排障

### 1. 管理后台提示 VoiceBox 连接失败

先在 Story Matrix AI 后端所在机器上测试：

```bash
curl -i https://voicebox.example.com/health \
  -H 'Authorization: Bearer change-this-to-a-long-random-secret'
```

如果 curl 失败，问题在 nginx、DNS、证书、防火墙或 VoiceBox 服务本身，不在 Story Matrix AI。

### 2. 返回 401 Unauthorized

检查三处是否一致：

- nginx 中配置的 token/API key。
- Story Matrix AI 管理后台填写的 token/API key。
- 选择的鉴权方式是否匹配 nginx 配置。

Bearer Token 模式下，nginx 期望的是：

```http
Authorization: Bearer <token>
```

`X-API-Key` 模式下，nginx 期望的是：

```http
X-API-Key: <key>
```

自定义 Header 模式下，Header 名称和值必须完全一致。

### 3. 上传参考音频时报 413

nginx 请求体限制太小。提高：

```nginx
client_max_body_size 200m;
```

改完后：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 4. 生成音频或下载音频超时

长音频生成和下载可能耗时较久。提高 nginx 超时：

```nginx
proxy_read_timeout 600s;
proxy_send_timeout 600s;
proxy_connect_timeout 30s;
```

### 5. 音频无法拖动进度条

Story Matrix AI 会转发浏览器的 `Range` 请求到 VoiceBox，并转发 `content-range`、`accept-ranges` 等响应头。若仍无法拖动，检查 VoiceBox 自身的 `/audio/{generation_id}` 是否支持 Range：

```bash
curl -I https://voicebox.example.com/audio/<generation_id> \
  -H 'Authorization: Bearer change-this-to-a-long-random-secret' \
  -H 'Range: bytes=0-1023'
```

如果 VoiceBox 不返回 `206 Partial Content` 或 `Accept-Ranges`，只能由 VoiceBox 侧增强 Range 支持。

### 6. 后台保存后密钥显示为已配置

这是正常行为。Story Matrix AI 会对非明文展示场景做脱敏，避免把 VoiceBox 凭据暴露给不该看到的人。

如果要更换密钥，直接在对应字段输入新值并保存。

## 最小可用配置清单

部署前逐项确认：

- [ ] VoiceBox 在服务器本机或内网可访问。
- [ ] nginx 域名 `https://voicebox.example.com` 可访问。
- [ ] nginx 已配置 `client_max_body_size`，能上传参考音频。
- [ ] nginx 已配置足够长的 `proxy_read_timeout` 和 `proxy_send_timeout`。
- [ ] nginx 已配置 Bearer Token、`X-API-Key` 或自定义 Header 鉴权。
- [ ] `curl https://voicebox.example.com/health` 不带鉴权返回 `401`。
- [ ] `curl https://voicebox.example.com/health` 带鉴权返回健康状态。
- [ ] Story Matrix AI 管理后台填写了同一个服务地址和鉴权方式。
- [ ] 管理后台点击 **检查连接 / 刷新音色** 成功。
- [ ] 全文预览中能绑定音色、AI 分段、生成并播放章节音频。

## 推荐生产配置总结

如果没有特殊要求，推荐使用：

| 项目 | 推荐值 |
|------|--------|
| VoiceBox 对外地址 | `https://voicebox.example.com` |
| nginx 鉴权 | Bearer Token |
| Story Matrix AI 鉴权方式 | Bearer Token |
| 默认引擎 | `f5-tts` |
| 默认语言 | `zh` |
| 分块 | 开启 |
| 归一化 | 开启 |
| 交叉淡化 | `0.15` |

这套配置最直接，和 Story Matrix AI 当前后端代理实现完全匹配。
