# 两表架构重构方案

本文档用于指导后续 session 重构“简单记分鸭”的数据层、云函数和房间页同步逻辑。

目标不是在现有多表同步架构上继续补丁修复，而是将当前小程序收敛为更简单、可理解、可检查的两表模型。

## 1. 重构目标

当前项目已经实现了首页、创建房间、加入房间、房间页记分、转移、撤销、加入确认、移出成员、最近记录和多人同步。但当前数据和同步拆得过散：

- 成员、记录、读模型、同步通知分别散落在多张表中。
- 房间页同时依赖 `room_views`、`room_inboxes`、`room_events` 和主动 `getRoom` 回拉。
- 同步问题排查困难，容易出现操作端正确、其他端滞后或不同端记录顺序不一致。
- 后端和前端都在解释成员状态，责任边界不清。

重构后只保留两张业务表：

```text
users 用户表
rooms 房间表
```

核心原则：

1. `rooms` 是房间事实源。
2. `users` 只保存用户基本信息和关联房间 ID，不保存房间状态、分数、角色等会变化的数据。
3. 房间页只监听当前房间文档。
4. 所有写操作通过云函数事务完成。
5. 每次成功写操作都生成房间内记录。
6. 重复提交不做复杂幂等表，重复成功后可通过撤销处理。
7. 撤销必须按原记录积分变化量反向计算，不能用旧状态覆盖当前分数。
8. 当前阶段不物理删除房间数据；房间 7 天后只从用户视角隐藏。

## 2. 删除旧表

重构后不再使用以下集合：

```text
room_members
score_records
room_views
room_inboxes
room_events
room_codes
operation_requests
```

开发和验收阶段可以清空旧测试数据。新代码不得继续读写这些旧表。

## 3. users 用户表

用途：保存用户自己的基础信息和关联房间 ID。

字段结构：

```js
{
  _id: "用户 openid",
  openid: "用户 openid",
  defaultName: "首页默认名",
  roomIds: ["用户创建、加入或申请过的房间 ID"],
  createdAt: "创建时间",
  updatedAt: "更新时间"
}
```

字段说明：

```text
_id：直接使用微信 openid，确保一个用户只有一条用户记录。
openid：微信用户标识。
defaultName：首页保存的默认名。
roomIds：用户关联过的房间 ID 列表。
createdAt：用户记录创建时间。
updatedAt：用户记录更新时间。
```

用户表不得保存：

```text
房间名
房间码
用户在房间里的角色
用户在房间里的状态
用户在房间里的积分
房间是否待确认
房间是否关闭或过期
```

这些信息都从 `rooms` 中读取和计算。

## 4. rooms 房间表

用途：保存房间全部事实数据。房间信息、成员、积分、记录都在一个房间文档内。

字段结构：

```js
{
  _id: "房间 ID",
  roomCode: "房间码",

  name: "房间名称",
  ownerOpenid: "房主 openid",
  memberLimit: "人数上限",
  requireApproval: "是否需要房主确认加入",

  status: "房间状态",
  publicScore: "公共积分池分数",
  sequence: "房间操作序号",

  members: ["成员列表"],
  records: ["最近操作记录"],

  createdAt: "创建时间",
  updatedAt: "更新时间",
  expireAt: "24 小时可操作截止时间",
  hiddenAt: "7 天后玩家侧隐藏时间",
  closedAt: "关闭时间"
}
```

字段说明：

```text
_id：房间 ID。可以使用生成 ID，也可以直接使用房间码。若使用房间码作为 _id，需要保证生成时唯一。
roomCode：展示给用户的房间码。
name：房间名称。
ownerOpenid：房主用户 openid。
memberLimit：人数上限，当前最多 12。
requireApproval：是否开启加入确认。
status：房间状态，active 正常，closed 已关闭。
publicScore：公共积分池当前分数。
sequence：房间内每次成功操作递增，用于记录排序和同步判断。
members：房间成员数组。
records：房间最近操作记录数组，只保留最近 50 条或 100 条。
createdAt：房间创建时间。
updatedAt：房间更新时间。
expireAt：超过后房间不可继续写操作，只能查看。
hiddenAt：超过后首页不再展示，并从 users.roomIds 中懒清理。
closedAt：房主主动关闭时间。
```

当前阶段不物理删除 `rooms` 数据。

## 5. members 成员结构

成员直接内嵌在 `rooms.members` 中。

字段结构：

```js
{
  openid: "成员 openid",
  nickname: "房间内昵称",
  role: "角色",
  status: "成员状态",
  score: "当前积分",
  joinOrder: "加入顺序",
  nicknameEdited: "是否已改过名",
  joinedAt: "加入或申请时间",
  updatedAt: "更新时间",
  leftAt: "离开、移出或拒绝时间"
}
```

字段说明：

```text
openid：成员对应的用户 openid。
nickname：成员在当前房间里的显示昵称。
role：owner 房主，member 普通成员。
status：成员状态。
score：成员当前积分。
joinOrder：加入顺序，成员列表按该字段排序。
nicknameEdited：是否已经使用过一次改名机会。
joinedAt：加入或申请时间。
updatedAt：成员信息更新时间。
leftAt：被移出或被拒绝时间。
```

成员状态：

```text
active：已加入，可以参与。
pending：待确认，等待房主同意。
removed：已移出，保留历史记录，只能查看。
rejected：暂不加入，申请被拒绝。
```

状态规则：

1. `active` 成员计入人数。
2. `pending` 成员不计入 active 人数，但房主可见待确认卡。
3. `removed` 成员不计入人数，不可操作，仍显示为灰态。
4. `rejected` 成员不计入人数，不可操作，但保留在房间成员数组中，确保申请人能看到申请结果。
5. 不要在拒绝后直接删除成员，否则申请人无法得知结果。

## 6. records 记录结构

记录直接内嵌在 `rooms.records` 中。只保留最近 50 条或 100 条，具体数量在实现前统一确定。

不再使用 `beforeSnapshot` 和 `afterSnapshot`。改为保存本次操作的积分变化量 `scoreChanges`。

字段结构：

```js
{
  recordId: "记录 ID",
  sequence: "房间操作序号",
  type: "记录类型",
  operatorOpenid: "操作人 openid",
  operatorNickname: "操作人昵称",
  amount: "本次输入分值",
  scoreChanges: ["积分变化列表"],
  isUndone: "是否已被撤销",
  undoOfRecordId: "如果这是撤销记录，保存被撤销的记录 ID",
  undoneByRecordId: "如果这条记录已被撤销，保存撤销记录 ID",
  createdAt: "操作时间"
}
```

字段说明：

```text
recordId：记录唯一 ID。
sequence：房间内递增操作序号，越大越新。
type：记录类型。
operatorOpenid：操作人 openid。
operatorNickname：操作人当时的昵称。
amount：用户输入的分值。无积分变化的记录为 0。
scoreChanges：本次操作对成员或公共积分池造成的变化。
isUndone：这条记录是否已经被撤销。
undoOfRecordId：如果这是 undo 记录，指向被撤销的原记录。
undoneByRecordId：如果这条原记录已经被撤销，指向撤销记录。
createdAt：操作时间。
```

积分变化结构：

```js
{
  targetType: "变化对象类型",
  openid: "成员 openid",
  nickname: "成员昵称",
  delta: "积分变化量"
}
```

字段说明：

```text
targetType：member 成员，public 公共积分池。
openid：targetType 为 member 时保存成员 openid；public 不需要。
nickname：targetType 为 member 时保存操作当时的成员昵称，用于记录展示。
delta：变化量。正数表示增加，负数表示减少。
```

示例：

```js
// 给成员 A 加 5
scoreChanges: [
  { targetType: "member", openid: "A", nickname: "小明", delta: 5 }
]

// A 转给 B 3 分
scoreChanges: [
  { targetType: "member", openid: "A", nickname: "小明", delta: -3 },
  { targetType: "member", openid: "B", nickname: "小红", delta: 3 }
]

// 公共积分池转给 A 2 分
scoreChanges: [
  { targetType: "public", delta: -2 },
  { targetType: "member", openid: "A", nickname: "小明", delta: 2 }
]
```

无积分变化的记录，例如申请加入、暂不加入、移出成员、关闭房间：

```js
scoreChanges: []
```

记录类型：

```text
room_created：创建房间
member_join_requested：申请加入
member_joined：加入房间
member_join_rejected：暂不加入
member_removed：成员移出
member_add：成员加分
member_subtract：成员扣分
batch_add：批量加分
batch_subtract：批量扣分
member_to_member：成员转给成员
member_to_public：成员转入公共积分池
public_to_member：公共积分池转给成员
batch_transfer：批量转移
undo：撤销
room_closed：关闭房间
```

## 7. 房间生命周期

当前阶段不物理删除房间表数据。

生命周期规则：

```text
24 小时：可操作期
7 天：玩家可见期
7 天后：玩家侧软删除
数据库：不物理删除 room 文档
```

字段：

```text
expireAt：创建时间 + 24 小时。
hiddenAt：创建时间 + 7 天。
closedAt：房主主动关闭时间。
status：active 或 closed。
```

超过 `expireAt` 后：

```text
可以进入查看。
不能加入。
不能审批。
不能改名。
不能加分。
不能扣分。
不能批量记分。
不能转移。
不能撤销。
不能关闭。
```

超过 `hiddenAt` 后：

```text
首页不展示。
进入首页时从 users.roomIds 中移除。
rooms 表数据仍保留。
通过旧链接进入时提示房间已归档或不可继续查看。
```

## 8. 首页读取和懒清理规则

首页流程：

```text
1. 获取当前用户 openid。
2. 读取 users/{openid}。
3. 如果用户不存在，创建 users/{openid}。
4. 读取 users.roomIds 对应的 rooms。
5. 找不到的 roomId 视为无效。
6. 超过 hiddenAt 的房间视为玩家侧隐藏。
7. 将无效或已隐藏 roomId 从 users.roomIds 中删除。
8. 用剩余 rooms 渲染首页房间列表。
```

首页展示状态从房间表计算：

```text
在 room.members 中找到当前 openid。
根据 member.status 展示已加入、待确认、已移出、暂不加入。
根据 room.status 和 expireAt 展示可操作或只读状态。
```

用户表不保存这些状态，避免同步问题。

## 9. 房间页读取和同步规则

房间页流程：

```text
1. 进入房间页时调用 getRoom(roomId)。
2. 云函数读取 rooms/{roomId} 并校验当前用户是否可见。
3. 前端根据 room 文档渲染房间页。
4. 前端 watch rooms/{roomId}。
5. 房间文档变化时重新派生页面状态。
6. 离开房间页时关闭 watch。
```

不再使用：

```text
room_views
room_inboxes
room_events
```

房间页只监听当前房间文档。

可见性规则：

```text
房主可见。
active 成员可见。
pending 成员可见，用于等待确认。
removed 成员可见，用于查看历史。
rejected 成员可见，用于展示申请结果。
未在 members 中的用户不可见完整房间，只能走加入预览。
```

## 10. 写操作统一事务规则

所有写操作必须通过云函数事务处理。

统一流程：

```text
1. 开启事务。
2. 读取 rooms/{roomId}。
3. 校验房间是否存在。
4. 校验房间是否 active 且未超过 expireAt。
5. 校验操作者是否有权限。
6. 校验成员状态、人数上限、昵称重名、公共积分余额等业务规则。
7. 基于最新 room 数据计算新结果。
8. sequence + 1。
9. 生成 record。
10. 将 record 插入 rooms.records 头部或尾部。
11. 裁剪 records，只保留最近 N 条。
12. 写回 rooms/{roomId}。
13. 如本次是创建房间或申请加入，将 roomId 加入 users.roomIds。
14. 提交事务。
```

事务冲突处理：

```text
如果事务冲突，可以重试 2 到 3 次。
每次重试都必须重新读取最新 room。
不能用第一次读取的旧 room 继续写。
```

## 11. 重复提交处理

当前阶段不新增复杂幂等表，也不在房间中维护请求去重列表。

规则：

```text
前端使用 submitting 禁用按钮，减少重复点击。
后端每次收到请求，只要校验通过，就视为一次真实操作。
每次真实操作都写入一条记录。
如果用户重复提交导致多了一条记录，房主可以撤销多余记录。
```

这会让实现更简单，但必须接受网络重试或重复点击可能产生重复记录。

## 12. 撤销规则

撤销是本次重构的关键点。

禁止做法：

```text
不能把当前分数直接改回原记录操作前状态。
不能用旧状态覆盖当前房间数据。
```

正确做法：

```text
1. 找到要撤销的原记录。
2. 校验原记录存在。
3. 校验原记录未被撤销。
4. 校验原记录类型允许撤销。
5. 读取原记录 scoreChanges。
6. 将每一条 delta 反向应用到当前房间数据。
7. 新增 undo 记录。
8. 将原记录标记 isUndone = true。
9. 将原记录 undoneByRecordId 指向 undo 记录。
10. sequence + 1。
11. 写回 room。
```

示例：

```text
成员 A 当前 7 分。
原记录是 A +5。
撤销时不是把 A 改回 0。
撤销时是在当前 7 分基础上 -5。
结果 A = 2。
```

转移撤销：

```text
原记录：A -3，B +3。
撤销：A +3，B -3。
```

公共积分池撤销：

```text
原记录：公共积分池 -2，A +2。
撤销：公共积分池 +2，A -2。
```

## 13. 每个 action 的数据变化

```text
createRoom 创建房间
改 users：是，把 roomId 加到房主 roomIds
改 rooms：是，新建房间
写记录：room_created

joinRoom 申请或加入房间
改 users：是，把 roomId 加到用户 roomIds
改 rooms：是，新增成员；需要确认时 status=pending，不需要确认时 status=active
写记录：member_join_requested 或 member_joined

reviewJoinRequest 审批加入
改 users：否
改 rooms：是，将 pending 改 active 或 rejected
写记录：member_joined 或 member_join_rejected

updateNickname 修改昵称
改 users：否
改 rooms：是，修改当前成员 nickname 和 nicknameEdited
写记录：当前可不写积分记录；如果要追溯，可新增 nickname_updated，但当前阶段可不做

updateScore 单人加扣分
改 users：否
改 rooms：是，修改成员 score
写记录：member_add 或 member_subtract

batchUpdateScore 批量加扣分
改 users：否
改 rooms：是，修改多个成员 score
写记录：batch_add 或 batch_subtract

batchTransferScore 积分转移
改 users：否
改 rooms：是，修改成员 score 和/或 publicScore
写记录：member_to_member、member_to_public、public_to_member 或 batch_transfer

undoLastAction 撤销
改 users：否
改 rooms：是，按原记录 scoreChanges 反向应用
写记录：undo

removeMember 移出成员
改 users：否
改 rooms：是，将 active 改 removed
写记录：member_removed

closeRoom 关闭房间
改 users：否
改 rooms：是，将 status 改 closed
写记录：room_closed
```

## 14. 权限规则

房主权限：

```text
创建房间
同意或拒绝加入申请
给任意 active 成员加分或扣分
批量加分或扣分
从任意成员或公共积分池发起转移
撤销可撤销记录
移出普通成员
关闭房间
```

普通 active 成员权限：

```text
查看房间
分享房间
将自己的积分转给其他 active 成员
将自己的积分转入公共积分池
从公共积分池转给自己
修改自己昵称一次
```

pending 成员权限：

```text
查看等待确认状态
不能记分
不能转移
不能改名
不能查看不应展示的操作入口
```

removed 成员权限：

```text
查看历史结果
不能记分
不能转移
不能改名
```

rejected 成员权限：

```text
查看申请未通过状态
不能记分
不能转移
不能改名
```

## 15. 前端改造范围

首页：

```text
读取 users/{openid}
根据 roomIds 批量读取 rooms
做隐藏房间懒清理
展示用户关联房间
默认名保存仍写 users.defaultName
```

创建页：

```text
调用 createRoom
成功后跳转房间页
不直接写数据库
```

加入页：

```text
根据 roomId 或 roomCode 获取房间预览
调用 joinRoom
如果 pending，跳转房间页展示等待确认
如果 active，跳转房间页展示成员状态
```

房间页：

```text
进入时调用 getRoom
只 watch rooms/{roomId}
根据 room.members 派生成员列表、待确认列表和当前用户状态
根据 room.records 派生最近记录
所有按钮调用云函数 action
所有写操作成功后可直接使用返回的 room 更新页面
watch 收到变化后也更新页面
离开页面关闭 watch
```

记录页：

```text
直接读取 rooms/{roomId}.records
展示最近记录
撤销仍调用云函数
```

## 16. 云函数改造建议

建议拆分文件，避免继续把所有逻辑堆在 `index.js`：

```text
cloudfunctions/scoreFunctions/index.js
  只做 action 分发

cloudfunctions/scoreFunctions/db.js
  数据库初始化、通用时间、集合名

cloudfunctions/scoreFunctions/room-domain.js
  房间状态、权限、成员查找、校验规则

cloudfunctions/scoreFunctions/room-records.js
  记录生成、scoreChanges、撤销计算

cloudfunctions/scoreFunctions/room-actions.js
  createRoom、joinRoom、updateScore 等 action

cloudfunctions/scoreFunctions/room-view.js
  将 room 文档转换为前端需要的返回结构
```

如果为了降低一次性改造风险，也可以先只拆 `records` 和 `domain`，但不要继续新增同步表。

## 17. 执行顺序

建议新 session 按以下顺序执行：

```text
1. 更新 docs/architecture.md，写入两表架构。
2. 更新 docs/requirements.md，说明新的数据和同步规则。
3. 清理或废弃旧集合引用。
4. 重写云函数数据读写逻辑，只读写 users 和 rooms。
5. 重写 getRoom、getRoomPreview、createRoom、joinRoom。
6. 重写房间页读取和 watch，只监听 rooms/{roomId}。
7. 重写加扣分、批量、转移、撤销、审批、移出、关闭。
8. 重写首页房间列表读取和懒清理。
9. 重写记录页数据读取。
10. 删除旧同步代码和旧工具函数。
11. 跑语法检查和关键词扫描。
12. 用微信开发者工具做人工验收。
```

## 18. 必须验收的场景

```text
1. 首页无用户记录时自动创建 users。
2. 首页保存默认名后创建页和加入页能带入。
3. 创建房间后 users.roomIds 包含该 roomId。
4. 创建房间后 rooms 中包含房主成员和 room_created 记录。
5. 普通加入无需确认时直接 active。
6. 开启确认时加入后 status=pending。
7. 房主端能看到 pending 成员。
8. 同意后 pending 变 active。
9. 暂不加入后 pending 变 rejected，申请人能看到结果。
10. 移出成员后 active 变 removed，成员仍可查看历史。
11. 单人加分、扣分正确。
12. 批量加分、扣分正确。
13. 成员转成员正确。
14. 成员转公共积分池正确。
15. 公共积分池转成员正确。
16. 公共积分不足时失败。
17. 普通成员不能越权加扣分、批量、撤销、关闭。
18. 撤销旧记录时按变化量反向计算，不覆盖后续分数。
19. 房间页 watch 当前 room 后，多端数据一致。
20. 离开房间页后关闭 watch。
21. 24 小时后房间只读。
22. 7 天后首页不展示，并从 users.roomIds 懒清理。
23. rooms 表中 7 天后数据仍保留。
```

## 19. 最终结论

本次重构的最终方向：

```text
用户表只存用户资料和房间 ID。
房间表存完整房间事实。
房间页只监听当前房间文档。
所有写操作走云函数事务。
每次成功操作写入房间记录。
撤销按 scoreChanges 反向计算。
重复提交不做复杂幂等，靠前端禁用按钮和后续撤销处理。
房间 24 小时后只读，7 天后从玩家视角隐藏，但不物理删除房间数据。
```

