import { Router } from 'express'
import crypto from 'crypto'
import db from '../db.js'
import { requireAdmin, type AuthenticatedRequest } from '../middleware/auth.js'

interface GitHubConfig {
  owner: string
  repo: string
  token: string
  labels?: string[] | string
}

interface GitHubIssueResponse {
  number?: number
  html_url?: string
}

const router = Router()

function getGitHubConfig(): GitHubConfig | null {
  const row = db.prepare('SELECT githubConfig FROM systemConfig WHERE id = ?').get('singleton') as { githubConfig?: string } | undefined
  if (!row?.githubConfig) return null
  const config = JSON.parse(row.githubConfig) as GitHubConfig
  if (!config.owner || !config.repo || !config.token) return null
  return config
}

function buildIssueBody(req: AuthenticatedRequest, body: string) {
  const user = req.currentUser
  return [
    body,
    '',
    '---',
    `提交人：${user.displayName} (${user.username})`,
    `用户 ID：${user.id}`,
  ].join('\n')
}

async function createGitHubIssue(config: GitHubConfig, title: string, body: string): Promise<GitHubIssueResponse> {
  const labels = Array.isArray(config.labels)
    ? config.labels
    : String(config.labels || '').split(',').map(label => label.trim()).filter(Boolean)

  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      body,
      labels: labels.length ? labels : ['user-feedback'],
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data.message === 'string' ? data.message : response.statusText
    throw new Error(`GitHub Issue 创建失败: ${response.status} ${message}`)
  }
  return data as GitHubIssueResponse
}

router.get('/', requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT feedback.*, users.username, users.displayName
    FROM feedback
    JOIN users ON users.id = feedback.userId
    ORDER BY feedback.createdAt DESC
  `).all()
  res.json(rows.map((row: any) => ({
    ...row,
    submitter: row.displayName || row.username,
    submitterId: row.userId,
    githubIssueError: row.githubError,
  })))
})

router.post('/', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const title = String(req.body.title || '').trim()
  const body = String(req.body.body || '').trim()
  if (!title || !body) return res.status(400).json({ error: '缺少标题或内容' })

  const id = crypto.randomUUID()
  const now = Date.now()
  const githubConfig = getGitHubConfig()
  let githubIssueNumber: number | null = null
  let githubIssueUrl: string | null = null
  let githubError: string | null = null

  if (githubConfig) {
    try {
      const issue = await createGitHubIssue(githubConfig, title, buildIssueBody(authReq, body))
      githubIssueNumber = typeof issue.number === 'number' ? issue.number : null
      githubIssueUrl = typeof issue.html_url === 'string' ? issue.html_url : null
    } catch (err: unknown) {
      githubError = err instanceof Error ? err.message : 'GitHub Issue 创建失败'
    }
  } else {
    githubError = 'GitHub Issue 未配置'
  }

  db.prepare(`
    INSERT INTO feedback (id, userId, title, body, status, githubIssueNumber, githubIssueUrl, githubError, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, authReq.currentUser.id, title, body, 'open', githubIssueNumber, githubIssueUrl, githubError, now, now)

  const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as any
  res.status(201).json({ ...row, githubIssueError: row.githubError })
})

export default router
