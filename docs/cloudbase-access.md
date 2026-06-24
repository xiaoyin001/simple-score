# 云开发访问与部署说明

更新日期：2026-06-24

本项目使用微信云开发 CloudBase，不再维护本地模拟服务。云端访问通过 CloudBase CLI 的本机登录态完成，不在仓库内保存 `SecretId`、`SecretKey`、Token 或任何长期凭证。

## 当前环境

```text
环境 ID：cloud1-d0g5o9l1ada4cc67e
套餐：个人版
状态：正常
业务云函数：scoreFunctions
数据集合：rooms、room_members、score_records
```

该环境 ID 不是密钥，可用于部署和查询命令。真实授权来自执行机器上的 CloudBase CLI 登录态。

## 登录

首次访问或登录态失效时，在项目根目录执行：

```bash
tcb login
```

CLI 会打开浏览器授权页，或输出授权链接和用户码。按提示完成授权后，可用以下命令验证：

```bash
tcb env list
```

如果在 Windows PowerShell 中遇到 `tcb.ps1 cannot be loaded because running scripts is disabled`，使用 Git Bash 执行 `tcb`，或在 PowerShell 中改用 npm 生成的 cmd 入口：

```powershell
& "$env:APPDATA\npm\tcb.cmd" env list
```

## 常用只读检查

查看环境：

```bash
tcb env list
```

查看云函数：

```bash
tcb -e cloud1-d0g5o9l1ada4cc67e fn list
```

查看 `scoreFunctions` 信息：

```bash
tcb -e cloud1-d0g5o9l1ada4cc67e fn detail scoreFunctions
```

查看云函数日志：

```bash
tcb -e cloud1-d0g5o9l1ada4cc67e fn log scoreFunctions
```

读取云数据库前应先说明查询集合、过滤条件和返回条数；默认优先使用计数或有限字段查询，避免读取不必要的用户数据。

## 部署云函数

部署当前本地 `scoreFunctions` 到免费云环境：

```bash
tcb -e cloud1-d0g5o9l1ada4cc67e fn deploy scoreFunctions --dir cloudfunctions/scoreFunctions --force
```

部署后在微信开发者工具中重新编译小程序，并人工验证创建房间、加入房间、记分、转移、撤销和关闭房间流程。

## 安全边界

1. 不要把主账号长期密钥写入仓库或聊天。
2. 不要提交 CloudBase CLI 本地登录缓存。
3. 读取云端数据前先确认目的和范围。
4. 写操作只在明确需要部署、修复或初始化集合时执行。
5. 涉及线上数据导出时，应先脱敏或限制字段。
