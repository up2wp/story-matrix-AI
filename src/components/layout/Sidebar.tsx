import { Layout, Menu, Tag } from 'antd'
import {
  AppstoreOutlined,
  BulbOutlined,
  GlobalOutlined,
  BranchesOutlined,
  AimOutlined,
  FileTextOutlined,
  SettingOutlined,
  ReadOutlined,
  CustomerServiceOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router'
import { useStore } from '@/core/store'
import { useAuthStore } from '@/core/auth-store'
import { useSystemConfigStore } from '@/core/system-config-store'

const { Sider } = Layout
const appVersion = __APP_VERSION__

export default function Sidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const readOnly = useStore((s) => s.readOnly)
  const currentWork = useStore((s) => s.currentWork)
  const setCurrentWork = useStore((s) => s.setCurrentWork)
  const setReadOnly = useStore((s) => s.setReadOnly)
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const voiceboxConfig = useSystemConfigStore((s) => s.voiceboxConfig)
  const canUseFeature = useSystemConfigStore((s) => s.canUseFeature)

  const hasWork = !!currentWork
  const canBackfill = Boolean(currentWork?.chapters?.some(chapter => chapter.content.trim())) && !readOnly && canUseFeature(user, 'importBackfill')
  const voiceboxReady = voiceboxConfig.serviceUrl !== 'http://127.0.0.1:17493'

  const menuItems = [
    { key: '/works', icon: <AppstoreOutlined />, label: '作品列表' },
    ...(!readOnly
      ? [{ key: '/voices', icon: <CustomerServiceOutlined />, label: '声音管理' }]
      : []),
    ...(hasWork
      ? [
          { type: 'divider' as const },
          { key: '/seed', icon: <BulbOutlined />, label: '故事萌芽' },
          { key: '/world', icon: <GlobalOutlined />, label: '世界构建' },
          { key: '/constraints', icon: <AimOutlined />, label: '核心约束' },
          { key: '/outline', icon: <BranchesOutlined />, label: '主线大纲' },
          ...(canBackfill
            ? [{ key: '/backfill', icon: <SafetyCertificateOutlined />, label: '阶段反推' }]
            : []),
          ...(!readOnly && voiceboxReady
            ? [{ key: '/character-voices', icon: <CustomerServiceOutlined />, label: '角色声音' }]
            : []),
          { key: '/chapters', icon: <FileTextOutlined />, label: '章节丰盈' },
          { key: '/preview', icon: <ReadOutlined />, label: '全文预览' },
        ]
      : []),
    ...(user && ['owner', 'admin'].includes(user.role)
      ? [
          { type: 'divider' as const },
          { key: '/admin', icon: <SettingOutlined />, label: '系统管理' },
        ]
      : []),
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === '/works') {
      // 回到作品列表时清除当前作品和只读状态
      setCurrentWork(null)
      setReadOnly(false)
    }
    navigate(key)
  }

  return (
    <Sider
      collapsed={collapsed}
      width={240}
      collapsedWidth={0}
      style={{
        background: '#fff',
        borderRight: '1px solid #f0f0f0',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {readOnly && (
        <div style={{ padding: '8px 16px', textAlign: 'center' }}>
          <Tag color="orange" style={{ margin: 0 }}>只读模式</Tag>
        </div>
      )}
      <Menu
        mode="inline"
        selectedKeys={[location.pathname]}
        items={menuItems}
        onClick={handleMenuClick}
        style={{ border: 'none', flex: 1 }}
      />
      <div style={{ padding: '8px 16px', color: '#bfbfbf', fontSize: 12, textAlign: 'center' }}>
        版本 {appVersion}
      </div>
    </Sider>
  )
}
