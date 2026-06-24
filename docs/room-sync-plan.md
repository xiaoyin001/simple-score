# 房间同步设计：CloudBase 数据库监听

版本：v0.3  
日期：2026-06-24  
状态：已按房间级数据库监听实现

## 1. 决策

本项目房间同步采用 CloudBase 数据库 `watch()` 监听机制：

1. 写操作仍只走 `scoreFunctions`。
2. 客户端只监听当前房间相关数据，不直接写云端数据。
3. 监听范围以 `roomId` 为边界。
4. 页面收到数据库快照后，只更新房间、成员、记录对应区域。
5. 不再使用自建 WebSocket 推送服务。
6. 不再维护 `room_events` 事件表。

## 2. 当前数据是否满足监听

当前三张核心业务表已经满足房间级监听：

| 集合 | 监听条件 | 用途 |
| --- | --- | --- |
| `rooms` | `_id = roomId` 且 `memberOpenids` 包含当前 openid | 房间状态、公共积分、关闭状态、人数上限 |
| `room_members` | `roomId = 当前房间 ID` 且 `status = active` | 成员加入、改名、分数变化、排行 |
| `score_records` | `roomId = 当前房间 ID` | 最近操作记录 |

需要在 `rooms` 维护 `memberOpenids` 字段。该字段记录当前 active 成员 openid，用于 CloudBase 安全规则判断当前用户是否属于房间成员；创建、加入和 `getRoom` 读取时由云函数维护或回填。不需要单独事件表。

## 3. 页面监听流程

```text
onLoad
  -> getRoom 初次加载完整数据
  -> startRoomWatchers
       -> watch rooms 当前房间，查询条件包含 _id 和 memberOpenids
       -> watch room_members 当前房间 active 成员
       -> watch score_records 当前房间记录
```

离开页面：

```text
onHide / onUnload
  -> watcher.close()
```

重新显示页面：

```text
onShow
  -> 如果已有房间数据，则重新 startRoomWatchers
```

## 4. 局部更新规则

主动操作成功后，页面不再调用 `loadRoom()` 做整页回拉，不进入全页 loading 状态。操作结果由下列 watcher 按区域更新；`loadRoom()` 只保留给首次进入和用户主动下拉刷新。

### 4.1 rooms

收到当前房间快照后：

1. 更新 `room`。
2. 公共积分、房间状态、关闭状态立即反映到页面。
3. 不重置成员选择、弹窗和输入状态。

### 4.2 room_members

收到成员快照后：

1. 只重建 `members` 列表。
2. 根据积分重新排序成员排行。
3. 重新计算分数颜色和本人改名入口。
4. 不重新加载房间和记录。

### 4.3 score_records

收到记录快照后：

1. 按 `createdAt` 倒序排序。
2. 只保留最近 50 条用于房间页展示。
3. 重新格式化记录文案、分值、颜色和撤销入口。
4. 保持当前最近记录分页页码。
5. 如果最新记录快照包含 `afterSnapshot.room.publicScore`，同步刷新页面上的公共积分池展示，作为 `rooms` 监听之外的展示一致性保护。

## 5. 异常处理

监听异常时：

1. 房间页显示 `同步失败，请检查权限`。
2. 不自动轮询。
3. 用户下拉刷新时仍可调用 `getRoom` 获取云端完整数据，但不能替代修复数据库读权限。

## 6. 成本和限制

CloudBase 官方说明：

1. `watch()` 会监听集合中符合查询条件的数据变化。
2. 调用 `watcher.close()` 可关闭监听。
3. 一次监听记录数有上限，记录过多会影响初始化速度和监听稳定性。
4. 实时推送连接数受套餐限制。
5. 集合读权限仍然生效。

因此本项目控制边界：

1. 房间最多 12 人，成员监听规模可控。
2. 房间页记录只展示最近 50 条，但监听条件仍按 `roomId` 过滤，后续如单房间记录量过大，需要再增加记录分页或事件压缩策略。
3. 房间页只在可见时监听，离开页面立即关闭。

权限要求：

1. `rooms`、`room_members`、`score_records` 必须允许当前房间成员读取对应 `roomId` 数据。
2. 写权限仍应禁止客户端直接写入，所有写操作继续通过 `scoreFunctions`。
3. 如果线上集合权限为“仅创建者可读”或完全禁止客户端读，房间页 watcher 会进入同步异常状态。

推荐安全规则：

`rooms`：

```json
{
  "read": "auth.openid in doc.memberOpenids",
  "write": false
}
```

对应前端监听查询必须包含 `memberOpenids: _.in(['{openid}'])`，否则会被 CloudBase 安全规则拒绝。

`room_members`：

```json
{
  "read": "auth.openid in get(`database.rooms.${doc.roomId}`).memberOpenids",
  "write": false
}
```

`score_records`：

```json
{
  "read": "auth.openid in get(`database.rooms.${doc.roomId}`).memberOpenids",
  "write": false
}
```

`room_members` 和 `score_records` 的监听查询必须包含 `roomId`，当前实现已满足该要求。

## 7. 验收

人工验收：

1. A 创建房间并停留在房间页。
2. B 加入房间后，A 页面自动出现 B。
3. C 加入房间后，A 和 B 页面自动出现 C。
4. B 修改昵称后，A 和 C 页面对应成员名自动变化。
5. A 给 B 加分后，B 和 C 页面更新 B 的分数、成员排行和最近记录。
6. 批量记分后，所有在线成员页面更新受影响成员和最近记录。
7. 积分转移后，所有在线成员页面更新相关成员、公共积分和最近记录。
8. 关闭房间后，所有在线成员页面进入只读状态。
9. 离开房间页后监听关闭，重新进入后重新建立监听。

自动检查：

1. 项目规定的 `node --check`。
2. 模板内容检查。
3. 高风险文案检查。
