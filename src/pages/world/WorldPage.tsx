import { Tabs, Typography } from 'antd'
import { BookOutlined, UserOutlined, TeamOutlined } from '@ant-design/icons'
import SettingsPanel from './SettingsPanel'
import CharactersPanel from './CharactersPanel'
import SupportingPanel from './SupportingPanel'
import { useWorldBuilder } from '@/features/world/useWorldBuilder'

const { Title } = Typography

const tabItems = [
  { key: 'settings', label: '世界观设定', icon: <BookOutlined /> },
  { key: 'characters', label: '主要人物', icon: <UserOutlined /> },
  { key: 'supporting', label: '非主要人物', icon: <TeamOutlined /> },
]

export default function WorldPage() {
  const wb = useWorldBuilder()

  if (!wb.currentWork) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Title level={4} type="secondary">
          请先在「故事萌芽」中创建作品
        </Title>
      </div>
    )
  }

  return (
    <div>
      <Title level={3} style={{ marginBottom: 16 }}>世界构建</Title>

      <Tabs
        activeKey={wb.activeTab}
        onChange={(key) => wb.setActiveTab(key as typeof wb.activeTab)}
        items={tabItems}
      />

      {wb.activeTab === 'settings' && <SettingsPanel wb={wb} />}
      {wb.activeTab === 'characters' && <CharactersPanel wb={wb} />}
      {wb.activeTab === 'supporting' && <SupportingPanel wb={wb} />}
    </div>
  )
}
