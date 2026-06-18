### 开发守则

- 接口开发时优先传最小内容，禁止单次请求发送/接收整章内容
- 注重用户体验，且需要考虑移动端便捷性

### 其它事项

- LSP 缺失不要仅说未安装 xxx，还应当写出可选的安装命令

### 本地服务验证

- 需要验证后端/API 或生产构建页面时，先运行 `npm run build`，再用已构建产物启动服务。
- 在 agent/harness 环境中，不要用 `Start-Process` 直接启动 `node dist/index.js` 或带 stdout/stderr 重定向的后台进程；这类进程容易被 shell 工具回收，导致后续 `curl`/浏览器验证连接被拒绝或命令卡死。
- 如果验证脚本需要多次 HTTP 调用，优先把“启动服务 → 调用接口/浏览器 → 清理服务”放在同一个 PowerShell 调用里完成；跨工具调用保存的 Job 或启动器 PID 可能只代表启动窗口，不代表真正的 Node 服务。
- Windows 下推荐使用脱离当前 shell 的启动方式，并记录 PID 文件，示例：

```powershell
$pidFile = Join-Path $env:TEMP 'story-matrix-local-server.pid'
if (Test-Path -LiteralPath $pidFile) {
  $oldPid = Get-Content -LiteralPath $pidFile
  Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidFile -Force
}
$proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c','start','"story-matrix-local"','/min','npm.cmd','run','start') -WorkingDirectory 'server' -PassThru
Set-Content -LiteralPath $pidFile -Value $proc.Id
Start-Sleep -Seconds 4
Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health'
```

- 验证完成必须清理本地服务，注意不要使用 PowerShell 内置只读变量 `$PID` 作为变量名：

```powershell
$pidFile = Join-Path $env:TEMP 'story-matrix-local-server.pid'
if (Test-Path -LiteralPath $pidFile) {
  $serverPid = Get-Content -LiteralPath $pidFile
  Stop-Process -Id ([int]$serverPid) -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidFile -Force
}
```
