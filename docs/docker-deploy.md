# Docker 部署手册

本文档说明如何用 Docker 部署 Story Matrix AI。容器会构建前端静态文件、编译后端，并由 Express 在同一个服务中提供前端页面和 `/api` 接口。

## 前置要求

- Docker Engine
- Docker Compose V2
- 可访问的 `3001` 端口

Ubuntu 可参考以下命令安装 Docker 与 Docker Compose V2：

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker compose version
```

## 本地构建与启动

在项目根目录执行：

```bash
docker compose up -d --build
```

默认访问地址：http://localhost:3001

如果测试环境需要在局域网内通过 `http://服务器IP:3001` 访问，请在容器启动时设置 `NODE_ENV=development`。否则镜像默认的生产模式会为登录 Cookie 加上 `Secure` 标记，浏览器在普通 HTTP 地址下不会保存该 Cookie，表现为登录成功后又回到登录页。

```bash
docker run -d --name story-matrix-ai \
  -e NODE_ENV=development \
  -p 3001:3001 \
  -v story-matrix-data:/app/server/data \
  ghcr.io/up2wp/story-matrix-ai:latest
```

该方式只建议用于内网测试。正式公网部署建议使用 HTTPS，并保留镜像默认的生产模式。

查看运行日志：

```bash
docker compose logs -f story-matrix-ai
```

停止服务：

```bash
docker compose down
```

## 数据持久化

SQLite 数据库位于容器内 `/app/server/data/story-matrix.db`。`docker-compose.yml` 使用 `story-matrix-data` volume 持久化该目录，所以普通重启和重新创建容器不会丢失作品数据。

如需连同数据一起删除：

```bash
docker compose down -v
```

## 默认账号

首次启动时后端会自动创建管理员账号：

- 用户名：`admin`
- 密码：`admin`

首次登录后请在管理后台修改密码，并配置 AI 服务的 Base URL、模型和 API Key。

## 直接使用镜像

构建本地镜像：

```bash
docker build -t story-matrix-ai:local .
```

运行镜像：

```bash
docker run -d --name story-matrix-ai -p 3001:3001 -v story-matrix-data:/app/server/data story-matrix-ai:local
```

如果本地镜像也用于内网 HTTP 测试，同样可以加上 `-e NODE_ENV=development`：

```bash
docker run -d --name story-matrix-ai \
  -e NODE_ENV=development \
  -p 3001:3001 \
  -v story-matrix-data:/app/server/data \
  story-matrix-ai:local
```

## 发布标签触发镜像构建

GitHub Actions 会在推送 `v*.*.*` 标签时构建并推送 Docker 镜像到 GitHub Container Registry。

示例：

```bash
git tag v0.1.0
git push origin v0.1.0
```

镜像名格式：

```text
ghcr.io/<owner>/<repo>:0.1.0
ghcr.io/<owner>/<repo>:v0.1.0
```
