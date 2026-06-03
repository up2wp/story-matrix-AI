import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { seed } from './seed.js'
import authRouter from './routes/auth.js'
import usersRouter from './routes/users.js'
import worksRouter from './routes/works.js'
import systemConfigRouter from './routes/system-config.js'
import { requireAuth, requireAdmin } from './middleware/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT || '3001', 10)

const app = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// 公开路由（无需登录）
app.use('/api/auth', authRouter)

// users 路由：POST 公开（注册），其余需登录
app.use('/api/users', usersRouter)
// 需要登录的路由
app.use('/api/works', requireAuth, worksRouter)
// 需要管理员权限的路由
app.use('/api/system-config', requireAdmin, systemConfigRouter)

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
