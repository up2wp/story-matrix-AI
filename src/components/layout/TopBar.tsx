import { useState } from 'react'
import { Layout, Space, Button, Typography, Dropdown, Modal, Form, Input, message } from 'antd'
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  LockOutlined,
  IdcardOutlined,
  DownOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router'
import { useStore } from '@/core/store'
import { useAuthStore } from '@/core/auth-store'

const { Header } = Layout
const { Title } = Typography

export default function TopBar() {
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const changePassword = useAuthStore((s) => s.changePassword)
  const updateProfile = useAuthStore((s) => s.updateProfile)
  const navigate = useNavigate()

  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileForm] = Form.useForm()
  const [pwdModalOpen, setPwdModalOpen] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdForm] = Form.useForm()

  const openProfileModal = () => {
    profileForm.setFieldsValue({ displayName: user?.displayName })
    setProfileModalOpen(true)
  }

  const handleUpdateProfile = async (values: { displayName: string }) => {
    setProfileLoading(true)
    try {
      const result = await updateProfile(values.displayName)
      if (result.success) {
        message.success('资料已更新')
        setProfileModalOpen(false)
      } else {
        message.error(result.error || '修改失败')
      }
    } finally {
      setProfileLoading(false)
    }
  }

  const handleChangePassword = async (values: { oldPassword: string; newPassword: string; confirmPassword: string }) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的新密码不一致')
      return
    }
    setPwdLoading(true)
    try {
      const result = await changePassword(values.oldPassword, values.newPassword)
      if (result.success) {
        message.success('密码修改成功')
        setPwdModalOpen(false)
        pwdForm.resetFields()
      } else {
        message.error(result.error || '修改失败')
      }
    } finally {
      setPwdLoading(false)
    }
  }

  const userMenuItems = [
    {
      key: 'profile',
      icon: <IdcardOutlined />,
      label: '个人资料',
      onClick: openProfileModal,
    },
    {
      key: 'password',
      icon: <LockOutlined />,
      label: '修改密码',
      onClick: () => setPwdModalOpen(true),
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: () => { logout(); navigate('/login') },
    },
  ]

  return (
    <>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          padding: '0 16px',
          height: 48,
          lineHeight: '48px',
        }}
      >
        <Space>
          <Button
            type="text"
            icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={toggleSidebar}
          />
          <Title level={5} style={{ margin: 0 }}>Story Matrix AI</Title>
        </Space>
        <Space>
          <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
            <Button type="text" icon={<UserOutlined />}>
              {user?.displayName} <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
        </Space>
      </Header>

      <Modal
        mask={{ closable: false }}
                title="个人资料"
        open={profileModalOpen}
                onCancel={() => { setProfileModalOpen(false); profileForm.resetFields() }}
        onOk={() => profileForm.submit()}
        confirmLoading={profileLoading}
        okText="保存"
        cancelText="取消"
      >
        <Form form={profileForm} onFinish={handleUpdateProfile} layout="vertical">
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        mask={{ closable: false }}
                title="修改密码"
        open={pwdModalOpen}
        forceRender
                onCancel={() => { setPwdModalOpen(false); pwdForm.resetFields() }}
        onOk={() => pwdForm.submit()}
        confirmLoading={pwdLoading}
        okText="确认修改"
        cancelText="取消"
      >
        <Form form={pwdForm} onFinish={handleChangePassword} layout="vertical">
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 4, message: '密码至少4位' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" rules={[{ required: true, message: '请确认新密码' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
