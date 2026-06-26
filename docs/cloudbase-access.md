# 云开发访问与部署说明

更新日期：2026-06-26

本项目使用微信云开发 CloudBase，不维护本地模拟服务。云端访问通过 CloudBase CLI 的本机登录态完成，不在仓库内保存 `SecretId`、`SecretKey`、Token 或任何长期凭证。

## 当前环境

```text
环境 ID：cloud1-d0g5o9l1ada4cc67e
套餐：个人版
状态：正常
业务云函数：scoreFunctions
数据集合：users、rooms
```

该环境 ID 不是密钥，可用于部署和查询命令。真实授权来自执行机器上的 CloudBase CLI 登录态。

## 登录

首次访问或登录态失效时，在项目根目录执行：

```bash
tcb login
```

验证登录态：

```bash
tcb env list
```

Windows PowerShell 如遇到 `tcb.ps1` 执行策略限制，可使用 npm 生成的 cmd 入口：

```powershell
& "$env:APPDATA\npm\tcb.cmd" env list
```

## 常用只读检查

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

## 数据集合权限

当前业务只使用两张集合：

```text
users: private 或仅云函数写
rooms: adminwrite
```

所有业务写入都必须通过 `scoreFunctions`。房间页客户端只监听当前 `rooms/{roomId}` 文档用于展示同步，不直接写房间、成员、积分或记录。

如果线上安全规则禁止客户端读取 `rooms`，房间页仍能通过 `getRoom` 加载，但实时同步会失败；需要在云开发控制台为当前房间成员可读场景配置合适的读权限，或在开发阶段临时使用 `adminwrite` 验证功能。

## 部署云函数

部署当前本地 `scoreFunctions` 到免费云环境时，建议进入云函数目录执行：

```bash
cd cloudfunctions/scoreFunctions
tcb -e cloud1-d0g5o9l1ada4cc67e fn deploy scoreFunctions --force --dir . --runtime Nodejs16.13 --deployMode cos
cd ../..
```

部署后确认 `$LATEST` 状态为“部署完成”：

```bash
tcb -e cloud1-d0g5o9l1ada4cc67e fn list-function-versions scoreFunctions
tcb -e cloud1-d0g5o9l1ada4cc67e fn detail scoreFunctions
```

当前两表版本在线源码至少应包含 `getHomeData`、`saveDefaultName`、`scoreChanges` 和 `hiddenAt` 等关键标记。

## 生命周期

当前阶段不创建物理清理触发器。房间创建后：

```text
24 小时后：只读，不能继续写操作。
7 天后：首页不展示，并从 users.roomIds 懒清理。
数据库：rooms 文档仍保留。
```

部署后在微信开发者工具中重新编译小程序，并人工验证创建房间、加入房间、记分、转移、撤销和关闭房间流程。

## 安全边界

1. 不要把主账号长期密钥写入仓库或聊天。
2. 不要提交 CloudBase CLI 本地登录缓存。
3. 读取云端数据前先确认目的和范围。
4. 写操作只在明确需要部署、修复或初始化集合时执行。
5. 涉及线上数据导出时，应先脱敏或限制字段。
