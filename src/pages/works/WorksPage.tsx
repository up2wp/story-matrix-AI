import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { Table, Button, Tag, Space, Switch, Popconfirm, Typography, message } from 'antd'
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { db } from '@/core/db'
import { useAuthStore } from '@/core/auth-store'
import { useStore } from '@/core/store'
import { generateId } from '@/utils/id'
import type { Work } from '@/core/types'

const { Title } = Typography

interface WorkItem extends Work {
  ownerName?: string
}

function getWorkProgress(work: WorkItem) {
  if (work.chapters?.length) return `章节丰盈（${work.chapters.length} 章）`
  if (work.constraints?.length) return `核心约束（${work.constraints.length} 条）`
  if (work.outline?.length) return '主线大纲'
  if (work.settings?.length) return '世界构建'
  return '故事萌芽'
}

export default function WorksPage() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const setCurrentWork = useStore(s => s.setCurrentWork)
  const setReadOnly = useStore(s => s.setReadOnly)
  const [works, setWorks] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)

  const loadWorks = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const allWorks = await db.works.toArray()
      let accessible: WorkItem[]

      if (user.role === 'owner' || user.role === 'admin') {
        // 拥有者和管理员看到所有作品
        const users = await db.users.toArray()
        const userMap = new Map(users.map(u => [u.id, u.displayName]))
        accessible = allWorks.map(w => ({ ...w, ownerName: userMap.get(w.ownerId) || '未知' }))
      } else {
        // 普通用户看到自己的作品 + 分享的作品
        accessible = allWorks
          .filter(w => w.ownerId === user.id || w.shared)
          .map(w => ({ ...w }))
      }

      accessible.sort((a, b) => b.updatedAt - a.updatedAt)
      setWorks(accessible)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { loadWorks() }, [loadWorks])

  const handleOpen = async (work: WorkItem, readOnly: boolean) => {
    const detail = readOnly ? await db.works.get(work.id) : work
    if (!detail) {
      message.error('无权查看该作品')
      return
    }
    setCurrentWork(detail)
    setReadOnly(readOnly)
    navigate('/seed')
  }

  const handleToggleShared = async (work: WorkItem, shared: boolean) => {
    await db.works.update(work.id, { shared })
    message.success(shared ? '已开启分享' : '已关闭分享')
    loadWorks()
  }

  const handleDelete = async (work: WorkItem) => {
    await db.works.delete(work.id)
    message.success('已删除')
    loadWorks()
  }

  const handleCopy = async (work: WorkItem) => {
    if (!user) return
    const newId = generateId()
    const { id, ownerName, ...rest } = work
    const newWork: Work = {
      ...rest,
      id: newId,
      ownerId: user.id,
      title: `${work.title}_副本`,
      shared: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await db.works.add(newWork)
    message.success(`已复制「${work.title}」`)
    loadWorks()
  }

  const isOwner = (work: WorkItem) => user && work.ownerId === user.id
  const canManageAllWorks = user?.role === 'owner' || user?.role === 'admin'
  const canView = (work: WorkItem) => isOwner(work) || canManageAllWorks || work.shared

  const columns: ColumnsType<WorkItem> = [
    {
      title: '作品名称',
      dataIndex: 'title',
      key: 'title',
      width: 200,
      ellipsis: true,
    },
    ...(canManageAllWorks
      ? [{ title: '创建人', dataIndex: 'ownerName', key: 'ownerName', width: 100 }]
      : []),
    {
      title: '进度/阶段',
      key: 'progress',
      width: 160,
      render: (_: unknown, record: WorkItem) => getWorkProgress(record),
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_: unknown, record: WorkItem) => {
        if (isOwner(record)) return <Tag color="blue">可编辑</Tag>
        if (canManageAllWorks || record.shared) return <Tag color="orange">只读</Tag>
        return <Tag color="orange">只读</Tag>
      },
    },
    {
      title: '分享',
      key: 'shared',
      width: 80,
      render: (_: unknown, record: WorkItem) => {
        if (!isOwner(record)) return record.shared ? <Tag color="green">已分享</Tag> : null
        return (
          <Switch
            size="small"
            checked={record.shared}
            onChange={(checked) => handleToggleShared(record, checked)}
          />
        )
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 170,
      render: (ts: number) => new Date(ts).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: WorkItem) => (
        <Space>
          {isOwner(record) ? (
            <Button type="link" icon={<EditOutlined />} onClick={() => handleOpen(record, false)}>
              编辑
            </Button>
          ) : canView(record) ? (
            <Button type="link" icon={<EyeOutlined />} onClick={() => handleOpen(record, true)}>
              查看
            </Button>
          ) : (
            null
          )}
          <Button type="link" icon={<CopyOutlined />} onClick={() => handleCopy(record)}>
            复制
          </Button>
          {isOwner(record) && (
            <Popconfirm title="确认删除此作品？" onConfirm={() => handleDelete(record)} okText="确认" cancelText="取消" okButtonProps={{ autoFocus: true }}>
              <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>作品列表</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setReadOnly(false); navigate('/seed') }}>
          新建作品
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={works}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20 }}
        scroll={{ x: 800 }}
      />
    </div>
  )
}
