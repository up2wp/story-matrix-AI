import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { seed } from './seed.js'
import authRouter from './routes/auth.js'
import usersRouter from './routes/users.js'
import worksRouter from './routes/works.js'
import systemConfigRouter from './routes/system-config.js'
import aiRouter from './routes/ai.js'
import { requireAuth } from './middleware/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT || '3001', 10)

const app = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// 公开路由（无需登录）
app.use('/api/auth', authRouter)

// users 路由：需登录，创建用户需管理员；公开注册走 /api/auth/register
app.use('/api/users', usersRouter)
// 需要登录的路由
app.use('/api/works', requireAuth, worksRouter)
app.use('/api/ai', requireAuth, aiRouter)
// system-config 路由：GET 公开，POST/PATCH 需管理员
app.use('/api/system-config', systemConfigRouter)

// 生产模式：serve 前端静态文件
const distPath = path.join(__dirname, '..', '..', 'dist')
app.use(express.static(distPath))
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

// 初始化数据库种子数据
seed()

app.listen(PORT, () => {
  console.log(`[server] Story Matrix AI 后端已启动: http://localhost:${PORT}`)
})
