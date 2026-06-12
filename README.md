# Story Matrix AI

AI 驱动的小说创作工具，帮助作者从灵感激发到成稿全流程高效创作。

## 创作流程

作品从零到成稿经历五个阶段，每个阶段可迭代回退：

```
故事萌芽 → 世界构建 → 主线大纲 → 核心约束 → 章节丰盈
```

1. **故事萌芽** — 用随机构建或灵感选择两种方式，快速确定时间、地域、类型、基调等基础信息，挑选初始主要人物
2. **世界构建** — AI 生成世界观设定，深化角色经历/性格/关系，自动补充非主要人物，实时检测一致性冲突
3. **主线大纲** — AI 生成起承转合的章节骨架，树状结构支持拖拽调整
4. **核心约束** — 定义关键事件、角色命运、伏笔回收等必要情节要素，作为章节生成的硬性约束
5. **章节丰盈** — 综合所有信息，逐场景生成正文草稿，支持续写、改写、对话生成等辅助模式

## 功能介绍

- **故事萌芽** — 随机构建 / 灵感选择，快速生成故事基础信息与候选人物
- **世界观构建** — 自动生成规则体系、地理政治、文化设定，支持关联引用与一致性检查
- **角色管理** — 主要人物深化 + 配角自动生成，经历/性格/关系/弧线全方位管理
- **大纲编辑器** — 树状结构（卷 > 章 > 节），支持拖拽排序与层级折叠
- **核心约束** — 五类约束（事件/命运/伏笔/红线/节奏），三级优先级，覆盖状态追踪
- **正文写作** — 沉浸式编辑器，场景提纲 + Markdown 格式 + 字数统计 + 专注模式
- **AI 辅助** — 基于上下文的续写、改写、扩写/缩写、风格迁移、对话生成
- **版本管理** — 章节级版本历史，支持对比与回滚
- **多线叙事** — 支持多视角、多时间线并行创作，矩阵式管理故事线
- **导出发布** — 导出为 TXT / EPUB / PDF，支持自定义排版模板
- **有声读物（Voicebox）** — 在全文预览中绑定旁白/角色音色，AI 分段后按章节生成、播放和下载有声读物清单

## 系统要求

| 项目 | 要求 |
|------|------|
| Node.js | >= 18.0.0 |
| npm | >= 9.0.0 |
| 操作系统 | Windows / macOS / Linux |
| 浏览器 | Chrome / Firefox / Edge（最新版本） |
| AI 服务 | OpenAI API 或兼容服务（vLLM、Ollama 等） |

## 快速开始

### 1. 安装依赖

```bash
# 安装前端依赖
npm install

# 安装后端依赖
cd server && npm install && cd ..
```

### 2. 启动开发服务器

```bash
# 终端 1：启动后端
npm run dev:server

# 终端 2：启动前端
npm run dev
```

### 3. 访问应用

打开浏览器访问 `http://localhost:5173`

### 4. Docker 部署

也可以直接拉取已构建镜像并运行：

```bash
docker run -itd --name story-matrix-ai --restart always -p 3001:3001 -v story-matrix-data:/app/server/data ghcr.io/up2wp/story-matrix-ai:latest
```

Docker 部署默认访问 `http://localhost:3001`。源码本地构建镜像部署的方法见 [Docker 部署手册](docs/docker-deploy.md)。

### 5. 默认账号

系统首次启动会自动创建管理员账号：

| 字段 | 值 |
|------|-----|
| 用户名 | `admin` |
| 密码 | `admin` |

> ⚠️ **安全提示**：首次登录后请立即修改默认密码。

### 6. 配置 AI 服务

登录后进入 **管理后台**，配置 AI 服务提供商：

| 提供商 | Base URL 示例 | 说明 |
|--------|---------------|------|
| OpenAI | `https://api.openai.com/v1` | 官方 API |
| vLLM | `http://192.168.1.100:8000/v1` | 本地部署 |
| Ollama | `http://localhost:11434/v1` | 本地部署 |

### 7. 配置 Voicebox 有声读物

如需生成有声读物，请先准备可访问的 Voicebox 服务，然后进入 **管理后台 → Voicebox** 配置服务地址。开发环境可使用默认地址 `http://127.0.0.1:17493`，生产环境应配置线上 Voicebox 域名，例如 `https://voicebox.example.com`。

Voicebox 请求始终由 Story Matrix AI 后端代理转发，浏览器不会直连 Voicebox，也不会持有 Voicebox 的鉴权凭据。管理后台支持以下鉴权方式：无鉴权、Bearer Token、`X-API-Key`、自定义 Header。

使用流程：

1. 在管理后台保存 Voicebox 地址和鉴权方式，并点击“检查连接 / 刷新音色”。
2. 在 **全文预览** 页面打开“有声读物”面板。
3. 为旁白和角色选择已有 Voicebox profile，或上传参考音频与对应文本到 Voicebox sample。
4. 选择已完成正文的章节，点击“AI 分段”，检查并编辑说话人、文本和语音提示词。
5. 点击“生成章节音频”，完成后可在线播放片段或下载章节级清单。

说明：Story Matrix AI 只保存 Voicebox profile/sample/generation ID、角色语音提示词和章节分段脚本；参考音频与生成音频仍由 Voicebox 管理。当前 v1 以章节级生成为边界，不做整本拼接或发布级后期。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 状态管理 | Zustand |
| UI 组件库 | Ant Design 6 |
| 富文本编辑器 | Tiptap |
| 构建工具 | Vite 8 |
| 后端框架 | Express 5 |
| 数据库 | SQLite（better-sqlite3） |
| AI SDK | Vercel AI SDK |

## 许可证

[MIT License](LICENSE) © 2026 Story Matrix AI Contributors
