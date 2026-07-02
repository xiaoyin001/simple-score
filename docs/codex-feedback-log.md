# Codex 反馈记录

本文件记录自动检查、Codex 复盘和人工体验评价。Codex 每次开发前应读取相关条目，每次开发后应按需追加反馈。

## 记录格式

```text
日期：
来源：auto | human | codex
场景：
结果：positive | negative
分值：
严重度：1-5
置信度：1-5
影响模块：
关联代码位置：
问题对应关系：
现象：
根因或推测：
处理方式：
是否需要新增自动检查或测试：
```

## 当前反馈

### 2026-07-02 已加入用户扫码后点击加入没有进入房间

```text
日期：2026-07-02
来源：human
场景：加入房间 / 扫码加入
结果：negative
分值：-6
严重度：4
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：`joinRoom`
- `miniprogram/pages/join-room/index.js`：`submit`、进入房间跳转
- `docs/requirements.md`、`docs/architecture.md`：重复加入行为说明
问题对应关系：
- 已加入用户通过扫码进入加入页后，再点击“加入房间”没有进入原房间：对应云函数先执行新成员加入可写校验，再判断是否已是成员；在房间已关闭或已过期等场景下，已加入用户被当成新加入流程拦截。
- 页面看起来没有反应：对应加入页在 `catch` 中展示错误后，`finally` 立即调用 `wx.hideLoading()`，可能把错误 toast 一并隐藏。
现象：
- 用户扫码加入自己已经加入过的房间时，点击加入按钮后未进入房间，预期应直接进入该房间。
根因或推测：
- `joinRoom` 的幂等分支顺序不正确，重复加入没有优先返回已有成员房间视图。
- 前端 loading 和错误提示生命周期未分离，失败反馈不稳定。
处理方式：
- `joinRoom` 在未归档前提下先识别当前用户是否已存在于成员列表；active 或 pending 成员直接返回 `roomView`、`roomId` 和 `alreadyJoined`，不重复创建成员，也不执行新成员加入校验。
- 加入页先关闭 loading，再跳转或展示错误；跳转失败时显示明确提示。
是否需要新增自动检查或测试：
- 当前通过语法检查覆盖；仍需要微信开发者工具或真机验证扫码进入加入页后，已加入用户点击加入能进入房间。
```

### 2026-07-02 长内容滚动到底部时背景出现硬分层

```text
日期：2026-07-02
来源：human
场景：首页 / 房间页 / 长内容滚动
结果：negative
分值：-3
严重度：2
置信度：5
影响模块：miniprogram
关联代码位置：
- `miniprogram/pages/index/index.wxss`：`page`、`.page`
- `miniprogram/pages/room/index.wxss`：`page`、`.page`
问题对应关系：
- 首页和房间页内容超过一屏后向上滑动，底部出现明显背景色断层：对应页面渐变只挂在小程序 `page` 节点，内容根容器没有自己的连续背景，长内容滚动时容易露出不同底色或重复背景段。
现象：
- 截图中已加入房间列表滚动到底部附近时，内容区与底部区域出现很硬的浅黄/浅白分层。
根因或推测：
- 小程序长页面滚动时，`page` 背景和实际内容容器的绘制范围不完全一致；渐变背景未显式限制重复，也没有由内容根容器承接，导致超过首屏后视觉底色不连续。
处理方式：
- 首页和房间页外层 `page` 统一为兜底底色；内容根容器 `.page` 承接顶部渐变，设置 `background-repeat: no-repeat` 和固定渐变高度，长内容下方使用同一底色延续。
是否需要新增自动检查或测试：
- 暂不新增命令行自动检查。该问题属于微信小程序视觉渲染差异，需要在微信开发者工具或真机中用超过一屏的房间列表和房间内容滚动到底部复验。
```

### 2026-07-02 房间二维码需要支持微信扫一扫进入加入页

```text
日期：2026-07-02
来源：human
场景：分享 / 扫码加入
结果：negative
分值：-7
严重度：4
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：`getRoomEntryCode`
- `cloudfunctions/scoreFunctions/config.json`：`wxacode.getUnlimited` openapi 权限
- `miniprogram/pages/room/index.js`：房间小程序码生成和展示
- `miniprogram/pages/index/index.js`：首页扫码解析
- `miniprogram/pages/join-room/index.js`：`scene` 参数解析
- `miniprogram/utils/room-entry.js`：房间入口参数解析
问题对应关系：
- 微信“扫一扫”扫描房间内二维码不能直接进入加入房间页：对应旧实现生成的是普通房间码文本二维码，不是微信小程序码。
- 首页“扫码加入”需要继续识别同一个码：对应扫码结果需要兼容小程序码 `path` / `scene`、普通 query 和旧房间码文本。
现象：
- 用户希望房间页二维码既能被微信“扫一扫”打开加入房间页，也能被首页扫码入口识别。
根因或推测：
- 普通文本二维码只能被小程序内扫码解析，不能稳定让微信客户端按小程序页面路径打开。
处理方式：
- 新增云函数 action 生成指向加入页的小程序码；房间页展示生成后的图片；加入页解析 `scene` 中的房间码；首页扫码统一解析小程序码路径、`scene`、query 和旧房间码文本。
是否需要新增自动检查或测试：
- 已通过语法检查覆盖；仍需部署云函数后在真机验证微信“扫一扫”和首页“扫码加入”都能进入对应加入房间页。
```

### 2026-07-02 页面 JSON 分享开关被开发者工具判定无效

```text
日期：2026-07-02
来源：human
场景：分享 / 微信开发者工具告警
结果：negative
分值：-2
严重度：2
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/*/index.json`：移除无效的 `enableShareAppMessage` 和 `enableShareTimeline`
- `miniprogram/pages/*/index.js`：继续保留 `onShareAppMessage`、`onShareTimeline` 和 `enablePageShare`
- `docs/architecture.md`：分享实现说明
问题对应关系：
- 控制台反复提示 `无效的 page.json ["enableShareAppMessage"] / ["enableShareTimeline"]`：对应页面 JSON 写入了当前开发者工具不认可的配置字段。
- 分享功能仍需要保留：对应分享能力由页面 JS 生命周期和 `wx.showShareMenu` 承担。
现象：
- 微信开发者工具控制台在多个页面反复输出无效 page.json 告警。
根因或推测：
- 页面 JSON 中的分享开关不是当前项目基础库/开发者工具认可的页面配置项。
处理方式：
- 移除所有页面 JSON 中的两个无效字段；保留页面 JS 分享生命周期函数和统一分享菜单开启逻辑。
是否需要新增自动检查或测试：
- 已通过 JSON 解析、语法检查和关键词扫描；仍需微信开发者工具重新编译后确认该告警消失，并验证右上角分享入口仍可用。
```

### 2026-07-02 首页扫码不识别房间码且微信扫一扫进入后未带入房间码

```text
日期：2026-07-02
来源：human
场景：分享 / 扫码加入
结果：negative
分值：-8
严重度：4
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：`getRoomEntryCode` 从 `wxacode.getUnlimited` 调整为 `wxacode.createQRCode`
- `cloudfunctions/scoreFunctions/config.json`：openapi 权限调整为 `wxacode.createQRCode`
- `miniprogram/pages/index/index.js`：首页扫码不再限制 `scanType`
- `miniprogram/utils/room-entry.js`：兼容旧 `scene` 纯房间码和键值参数
问题对应关系：
- 首页“扫码加入”无法识别房间页展示的码：对应上一版生成的是微信小程序码形态，不是普通二维码形态，小程序内 `wx.scanCode` 识别不稳定。
- 微信“扫一扫”能进入加入页但房间码没有自动填入：对应 `scene` 参数链路存在真机差异，加入页未稳定拿到 `roomCode`。
现象：
- 用户扫描房间页二维码时，首页扫码无法识别；用微信扫一扫打开加入页后房间码为空。
根因或推测：
- `wxacode.getUnlimited` 适合微信客户端扫一扫进入小程序，但不适合作为本小程序内 `wx.scanCode` 的唯一识别目标；`scene` 使用键值格式也增加了解析差异。
处理方式：
- 改用 `wxacode.createQRCode` 生成普通二维码形态的小程序二维码，路径直接携带 `roomCode`；首页扫码解析二维码返回的 `path`；同时保留旧 `scene` 解析兼容。
是否需要新增自动检查或测试：
- 已通过解析样例和语法检查；仍需部署云函数后在真机验证微信“扫一扫”和首页“扫码加入”都能进入加入页，且房间码自动填入。
```

### 2026-07-02 系统菜单提示当前页面不可转发不可分享

```text
日期：2026-07-02
来源：human
场景：分享
结果：negative
分值：-6
严重度：4
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/index/index.js`：首页缺少 `onShareAppMessage` 和 `onShareTimeline`
- `miniprogram/pages/create-room/index.js`：创建页缺少系统分享声明
- `miniprogram/pages/join-room/index.js`：加入页缺少系统分享声明和房间参数转发
- `miniprogram/pages/room/index.js`：房间页分享路径未直接落到加入页，缺少朋友圈分享处理
- `miniprogram/pages/records/index.js`：记录页缺少系统分享声明
- `miniprogram/pages/*/index.json`：页面缺少 `enableShareAppMessage` 和 `enableShareTimeline` 显式开关
- `miniprogram/utils/share.js`：统一分享菜单和分享卡片配置
问题对应关系：
- 微信菜单显示“当前页面不可转发 / 当前页面不可分享”：对应当前页面没有实现微信要求的分享生命周期函数，或没有主动开启分享菜单。
- 微信菜单中“发送给朋友”可用但“当前页面/朋友圈分享”仍不可用：对应页面 JSON 缺少朋友圈分享显式开关，或当前测试环境不支持该能力。
- 房间分享路径需要带用户进入正确房间：对应分享卡片必须携带 `roomId` 和 `roomCode`，并落到加入房间流程。
现象：
- 在小程序右上角菜单中，“当前页面不可转发”和“当前页面不可分享”置灰，用户无法从当前页面发起传播。
根因或推测：
- 首页、创建页、加入页和记录页没有声明 `onShareAppMessage` / `onShareTimeline`；房间页虽有基础好友分享函数，但没有统一开启系统菜单和朋友圈分享处理。二次验证中“发送给朋友”已可用，但“当前页面/朋友圈分享”仍灰，进一步补充页面 JSON 分享开关。
处理方式：
- 新增 `miniprogram/utils/share.js` 统一开启系统分享菜单和生成分享卡片；所有页面接入分享声明；房间相关分享携带 `roomId` 和 `roomCode` 并优先进入加入页；所有页面 JSON 显式开启 `enableShareAppMessage` 和 `enableShareTimeline`。
是否需要新增自动检查或测试：
- 当前通过语法检查覆盖；仍需微信开发者工具人工验证首页、房间页、加入页和记录页右上角菜单不再置灰，房间分享卡片可让未加入用户进入对应加入流程。
```

### 2026-07-01 loading 调用未成对警告

```text
日期：2026-07-01
来源：human
场景：房间页 / 单人记分 / 积分转移 / 操作反馈
结果：negative
分值：-2
严重度：2
置信度：5
影响模块：miniprogram
关联代码位置：
- `miniprogram/pages/room/index.js`：`updateMemberScore`、`runBatch`、`submitTransfer`、`reviewJoinRequest`、`removeMember`、`undoRecord`、`closeRoom`
问题对应关系：
- 控制台提示 `showLoading 与 hideLoading 必须配对使用`：对应用户取消弹窗后仍进入 `finally` 调用 `hideLoading`，以及成功后先 `showToast` 再 `hideLoading` 导致 loading 已被替换。
现象：
- 开发者工具控制台出现黄色 warning，指向房间页操作流程。
根因或推测：
- 多个房间页操作各自管理 `wx.showLoading` / `wx.hideLoading`，缺少统一的“已显示 loading”状态。
处理方式：
- 房间页新增 `showBusyLoading`、`hideBusyLoading`、`showBusySuccess`、`showBusyError`，所有操作统一先关闭 loading 再展示 toast，取消输入时不再触发未配对的 `hideLoading`。
是否需要新增自动检查或测试：
- 当前通过语法检查覆盖；仍需微信开发者工具人工验证单人加扣分、批量记分、转移、审批、移出、撤销和关闭房间时控制台不再出现该 warning。
```

### 2026-07-01 开发者工具实时监听登录态失败

```text
日期：2026-07-01
来源：human
场景：房间页 / 实时同步 / 微信开发者工具
结果：negative
分值：-3
严重度：2
置信度：4
影响模块：miniprogram
关联代码位置：
- `miniprogram/pages/room/index.js`：`startRoomWatchers`、`stopRoomWatchers`
问题对应关系：
- 开发者工具控制台出现 `realtime listener init watch fail`、`login fail`、`invalid state` 红色错误：对应房间页把 CloudBase watch 初始化失败用 `console.error` 输出，并继续保留 watcher 状态。
现象：
- 房间数据可通过 `getRoom` 获取，但控制台出现实时监听登录态错误，影响调试判断。
根因或推测：
- 微信开发者工具或基础库的实时数据库监听登录状态异常，属于监听通道不可用，不等同于房间数据加载失败。
处理方式：
- 房间页在识别实时监听登录态错误时关闭 watcher，标记本页不再重复启动监听，并保持 `getRoom` 快照展示；日志降级为 `console.warn`，避免误报为业务红错。
是否需要新增自动检查或测试：
- 当前通过语法检查覆盖；仍需在微信开发者工具中确认页面能正常查看，且控制台不再反复出现项目侧红色 `[room-sync]` 错误。
```

### 2026-07-01 未保存默认名和过期房间入口细节

```text
日期：2026-07-01
来源：human
场景：首页默认名 / 创建房间 / 过期房间只读
结果：negative
分值：-4
严重度：3
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `miniprogram/utils/profile.js`：未保存默认名的本地临时昵称生成
- `miniprogram/pages/create-room/index.js`：默认房间名
- `miniprogram/pages/room/index.js`、`miniprogram/pages/room/index.wxml`：过期房间操作入口
- `cloudfunctions/scoreFunctions/index.js`：昵称兜底
问题对应关系：
- 默认昵称显示为“我”：对应未保存默认名时缺少稳定但可区分的本地临时昵称。
- 创建房间需要手动输入房间名：对应创建页没有根据创建者昵称预填默认房间名。
- 过期房间从首页进入仍可能短暂显示操作按钮：对应房间页只依赖云函数返回状态，watcher 原始房间文档或本地入口可能没有立即派生过期只读状态。
现象：
- 用户希望默认名首次生成一次 `yyMMddHHmm`，后续未保存默认名时继续复用；创建房间默认名使用创建者昵称前缀；过期房间无需下拉刷新即可隐藏操作按钮。
根因或推测：
- 旧实现把“我”作为统一兜底，缺少一次性临时昵称；创建页只带入昵称不带入房间名；房间页部分操作入口直接判断 `room.status === 'active'`。
处理方式：
- 前端本地缓存 `userProfile.generatedName`；创建页默认填充“昵称前 6 个字符 + 的房间”；房间页统一派生 `isRoomOperable` 并用 `expireAt` 兜底转换只读状态；云函数昵称兜底改为时间格式。
是否需要新增自动检查或测试：
- 当前通过语法检查和关键词扫描覆盖；过期房间按钮隐藏仍需微信开发者工具构造过期房间人工验证。
```

### 2026-06-26 两表架构重构启动

```text
日期：2026-06-26
来源：codex
场景：数据层 / 云函数 / 房间页同步 / 首页房间列表 / 撤销
结果：positive
分值：8
严重度：4
置信度：4
影响模块：cloudfunctions / miniprogram / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：两表事实源、事务写入、scoreChanges 撤销
- `miniprogram/pages/room/index.js`：只监听 rooms 当前房间文档
- `miniprogram/pages/index/index.js`：从 users.roomIds 读取首页房间列表
- `docs/architecture.md`、`docs/requirements.md`、`docs/room-sync-plan.md`：两表模型文档
问题对应关系：
- 多表读模型和通知链路排查成本高：对应改为 `users` + `rooms`。
- 撤销不能覆盖后续分数：对应记录 `scoreChanges` 并按 delta 反向计算。
- 首页状态不应保存在用户表：对应从 room 文档派生成员状态和房间状态。
现象：
- 原方案需要维护成员表、记录表、读模型和通知表，操作端和被动端同步路径不一致。
根因或推测：
- 小程序房间人数上限 12、记录只保留最近 50 条，当前阶段更适合单房间文档事实源，避免同步派生表成为第二事实源。
处理方式：
- 云函数只读写 `users` 和 `rooms`；房间页只 watch 当前 room；写操作返回最新 `roomView`；重复成功通过撤销处理。
是否需要新增自动检查或测试：
- 继续保留语法检查、模板扫描和高风险词扫描；人工验收需覆盖多端同步、24 小时只读、7 天隐藏、撤销反向计算和普通成员权限。
```

### 2026-06-25 三端最近记录顺序不一致

```text
日期：2026-06-25
来源：human
场景：房间页 / 最近记录 / 多账号同步 / 加入申请 / 暂不加入
结果：negative
分值：-7
严重度：4
置信度：4
影响模块：cloudfunctions / miniprogram / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：`refreshRoomView`、`getRoom`
- `miniprogram/utils/records.js`：记录展示排序
- `miniprogram/pages/room/index.js`：房间页最近记录
- `miniprogram/pages/records/index.js`：完整记录页
- `docs/requirements.md`、`docs/architecture.md`：记录顺序约束
问题对应关系：
- 三个小程序窗口的最近记录显示不同最新项：对应服务端读模型和 getRoom 接口没有统一以房间内事务序号作为唯一权威顺序。
- 只按 `createdAt` 或数据库返回顺序展示：审批、申请等连续操作在同一分钟、多端时间对象解析或 watcher 回推先后不一致时可能乱序。
现象：同一房间内，房主端、成员端和第三个窗口的最近记录分别停在“暂不加入”或“申请加入”，记录顺序和最新记录不一致。
根因或推测：云函数记录已经写入房间内递增 `sequence`，但 `getRoom` 查询、`room_views` 读取和前端防御排序没有完全统一使用 `sequence`；不同客户端可能来自写操作响应、room_views watcher 或静默 getRoom 回拉三条路径。
处理方式：云函数 `score_records` 最近记录改为按 `sequence` 倒序读取并统一复排；小程序记录工具新增共享排序函数，房间页和记录页对所有来源的记录做防御性复排；需求和架构明确最近记录必须按 `sequence` 倒序展示。
是否需要新增自动检查或测试：需要。后续应补记录排序单元测试或云函数集成测试，构造相同分钟内的申请、拒绝、加入记录，断言房间页、记录页和 roomView 都以最大 `sequence` 为最新。
```

### 2026-06-25 审批加入后同步失败和页面闪烁

```text
日期：2026-06-25
来源：human / codex
场景：房间页 / 加入审批 / 移出成员 / room_views 监听 / room_events 失效通知 / 多账号同步
结果：negative
分值：-8
严重度：5
置信度：4
影响模块：scoreFunctions / miniprogram / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：`refreshRoomView`
- `miniprogram/pages/room/index.js`：`applyRoomViewSnapshot`、`applyRoomEventSnapshot`、`loadRoom`、`reviewJoinRequest`、`removeMember`
- `docs/requirements.md`、`docs/architecture.md`：同步策略说明
问题对应关系：
- 申请消息、同意加入和移出成员没有及时刷新：被动端只依赖 `room_views` watcher，遇到 watch 延迟、空快照、权限索引更新或开发工具多账号窗口切换时缺少独立的轻量失效通知。
- 固定 3 秒静默校准会让公网用户规模扩大时产生 `在线客户端数 × 时间` 的云函数调用，属于错误架构方向。
- 经常显示“同步失败”：`room_views` watcher 收到短暂空快照时，前端直接当成权限错误。
- 其他人页面闪烁：云函数刷新 `room_views` 使用整体 `set`，监听端可能观察到文档短暂重建；前端静默回拉前也会进入错误状态。
现象：房主端同意 pending 成员后，页面仍显示待确认或其他端未及时变更；被加入方未及时从待确认切换为成员；被移出方未及时灰态；房间页出现“同步失败，请检查权限”；多账号窗口中页面有短暂闪动。
根因或推测：CloudBase watch 在读模型整体重写、权限索引更新或多端窗口切换时可能推送空快照或短暂漏推；空快照不等于真实无权限。读模型更新方式也应尽量保持同一文档稳定更新；只在操作端成功后刷新无法覆盖被动参与者。以固定周期调用云函数兜底会把同步成本从“按变更计费”放大为“按在线时长计费”。
处理方式：`refreshRoomView` 改为优先 `update` 既有 `room_views` 文档，不存在时再创建；前端收到空快照时改为保持当前页面并做一次静默 `getRoom` 回拉；新增 `room_events/{roomId}` 轻量失效通知，只保存 sequence/version/updatedAt；客户端监听 `room_events`，只有发现远端 sequence 大于本地 sequence 时才静默调用一次 `getRoom`；取消固定 3 秒前台校准和主动操作成功后的无条件回拉；`getRoom` 读时修复成员可见列表或即时标记过期后同步刷新 `room_views` 和 `room_events`。
是否需要新增自动检查或测试：已通过项目基础语法检查和关键词扫描；云函数已部署并用 CLI 验证可调用。仍需要在微信开发者工具多账号窗口人工验证审批同步。
```

### 2026-06-25 房主暂不加入后操作端未即时更新

```text
日期：2026-06-25
来源：human / codex
场景：房间页 / 加入审批 / 暂不加入 / 操作端即时一致性
结果：negative
分值：-8
严重度：5
置信度：5
影响模块：scoreFunctions / miniprogram / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：写操作返回 `roomView`
- `miniprogram/pages/room/index.js`：`applyRoomViewData`、`applyWriteResult`、`reviewJoinRequest`
- `docs/requirements.md`、`docs/architecture.md`：写响应读模型策略
问题对应关系：
- 房主点击“暂不加入”后，房主端待确认卡没有消失：操作端成功写入后仍等待 watcher 回推，watcher 漏推或延迟时页面停留在旧状态。
- 不能恢复固定轮询或无条件回拉：公众小程序成本必须随房间实际变更增长，而不是随在线时长增长。
现象：房主端确认暂不加入后 toast 显示已处理，但成员区仍保留该 pending 申请。
根因或推测：取消主动操作后的无条件回拉后，缺少“写响应直接携带并应用最新读模型”的操作端即时更新路径。
处理方式：所有成功写操作在云函数完成事务和 `refreshRoomView` 后返回最新 `roomView`；房间页新增 `applyRoomViewData` 和 `applyWriteResult`，操作端直接应用响应读模型。其他在线端继续由 `room_views` 和 `room_events` 驱动，不增加固定周期云函数调用。
是否需要新增自动检查或测试：已通过项目基础语法检查和关键词扫描；需要在微信开发者工具多账号窗口验证“暂不加入”“同意加入”“移出成员”后操作端即时更新，其他端按事件驱动同步。
```

### 2026-06-25 发起加入申请后房主端未同步显示

```text
日期：2026-06-25
来源：human / codex
场景：房间页 / 加入申请 / 房主被动同步 / 成员私有通知
结果：negative
分值：-9
严重度：5
置信度：5
影响模块：scoreFunctions / miniprogram / docs / cloudbase
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：`refreshRoomView` 写入 `room_inboxes`
- `miniprogram/pages/room/index.js`：`startRoomWatchers`、`applyRoomInboxSnapshot`
- `docs/requirements.md`、`docs/architecture.md`、`docs/cloudbase-access.md`：成员级同步通知策略
问题对应关系：
- 新成员发起申请后，房主端不出现“同意加入 / 暂不加入”：房主属于被动端，不能依赖操作响应；`room_views` watcher 在当前开发工具/权限索引场景下仍可能漏推。
- `room_events` 房间级通知依赖集合宽读权限，不如成员私有通知符合公众小程序权限模型。
现象：申请端提交加入申请后，房主端只有手动刷新才出现待确认 UI。
根因或推测：被动端缺少可稳定按用户读取的轻量失效通知；单房间事件文档如果权限未设置为 `adminwrite`，客户端无法监听，且宽读模型不是最小权限。
处理方式：新增 `room_inboxes` 成员级通知集合；云函数每次刷新 `room_views` 后，为每个可读 openid 写入一条 `_openid = openid` 的轻量通知。客户端监听自己的 `roomId_openid` 文档，只有通知 sequence 大于本地 sequence 时才静默调用一次 `getRoom`。该方案成本按房间变更次数和房间成员数增长，本项目成员上限 12，不按在线时长轮询。
是否需要新增自动检查或测试：已通过 `npm.cmd run check`；云函数需部署后在多账号窗口验证：申请加入后房主端自动出现待确认 UI，且无需刷新。
```

### 2026-06-25 room_views 权限导致监听读模型不可见

```text
日期：2026-06-25
来源：auto / codex
场景：小程序自动化验收 / room_views 监听 / 云数据库权限
结果：negative
分值：-7
严重度：5
置信度：5
影响模块：cloudbase / miniprogram / docs
关联代码位置：
- `miniprogram/pages/room/index.js`：room_views 监听查询
- `docs/cloudbase-access.md`：权限前置条件
问题对应关系：
- 新增 `room_views` 后只部署云函数还不够，集合权限如果保持 `private`，客户端无法读取云函数写入的视图文档。
- 数组字段查询不能用 `_.in([openid])` 表达“数组包含当前 openid”，应直接用 `watchableOpenids: openid`。
现象：端到端脚本创建房间和 `getRoom` 成功，但客户端读取 `room_views` 返回空；服务端 NoSQL 查询确认文档存在且包含当前 openid。
根因或推测：`room_views` 是云函数写入，旧网关 `private` 权限只允许客户端读取本人 `_openid` 文档；查询条件也使用了不匹配数组包含语义的写法。
处理方式：将 `room_views` 云端权限同步为 `adminwrite`；房间页监听查询改为 `watchableOpenids: currentOpenid`；部署文档记录集合权限要求。
是否需要新增自动检查或测试：后续如迁移到 Rego 自定义策略，应新增权限策略部署和验证步骤；当前仍需在微信开发者工具中验证 `room_views` 可读性。
```

### 2026-06-25 工业级数据一致性和监听改造

```text
日期：2026-06-25
来源：human / codex
场景：架构 / 数据表 / 同步监听 / 并发一致性 / 自动测试
结果：positive
分值：+8
严重度：5
置信度：5
影响模块：scoreFunctions / miniprogram / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：写 action 幂等、事务内重读、room_views 刷新、getRoom 权限收口
- `cloudfunctions/scoreFunctions/core.js`：转移和撤销核心增量计算
- `miniprogram/utils/api.js`：写请求自动 requestId
- `miniprogram/pages/room/index.js`：room_views 单文档监听
- `docs/requirements.md`、`docs/architecture.md`、`docs/cloudbase-access.md`、`docs/codex-workflow.md`：新数据模型和检查流程
问题对应关系：
- 完整房间数据读取权限过宽：对应新增 `getRoomPreview`，并让 `getRoom` 校验当前用户属于房间。
- 三路 watcher 权限和乱序复杂：对应新增 `room_views` 单文档监听读模型。
- 公共积分转移并发丢失更新：对应事务内重新读取 `rooms.publicScore` 后计算。
- 加入、审批、移出、关闭与写操作并发：对应事务内重新读取房间和成员状态。
- 重复点击或网络重试可能重复写：对应 `operation_requests` 和前端 `requestId`。
- 历史高风险逻辑缺少自动测试：后续需要以仓库允许的方式补充正式自动回归能力。
现象：此前 MVP 可运行，但权限、监听、并发和测试体系还不足以支撑工业级演进。
根因或推测：初期实现优先跑通业务流程，部分写操作依赖事务外读取，监听拆成多个集合，自动化测试只覆盖语法和文案。
处理方式：引入幂等请求表、房间读模型、房间内 sequence、成员 joinOrder/nicknameKey/scoreRevision，并将关键写操作改为事务内重新校验和写入。
是否需要新增自动检查或测试：当前正式仓库保留基础语法检查和关键词扫描；后续仍应补云端或模拟数据库集成测试覆盖真实事务路径。
```

### 2026-06-24 默认名入口脱离头像授权流程

```text
日期：2026-06-24
来源：human
场景：首页 / 默认名设置 / 创建房间 / 加入房间
结果：negative
分值：-6
严重度：4
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/index/index.*`：首页默认名输入和保存区
- `miniprogram/utils/profile.js`：本地默认名缓存和“我”兜底
- `miniprogram/pages/create-room/index.js`：创建房间昵称带入
- `miniprogram/pages/join-room/index.js`：加入房间昵称带入
- `docs/requirements.md`、`docs/architecture.md`：默认名和头像处理边界
问题对应关系：
- 默认名字问题还没解决：对应首页身份胶囊把头像、授权和编辑入口混在一起，默认名设置不够直接。
- 头像不好处理就不处理头像：对应前端移除微信授权、头像选择和头像传参，只保留默认名。
- 设计图没有继续存在的意义：对应删除剩余方案图，并移除过时方案文档。
现象：用户无法明确完成默认名设置，头像处理增加了交互和审核复杂度，但对多人活动记分核心流程没有必要。
根因或推测：此前首页用户信息方案试图同时处理头像授权、身份展示和默认名编辑，导致默认名主任务被弱化。
处理方式：首页改为直接展示默认名输入和保存按钮；默认名未保存时前端使用“我”作为创建和加入房间昵称兜底；创建和加入请求不再传头像字段；删除未使用设计图和过时方案文档。
是否需要新增自动检查或测试：当前通过语法和文案检查覆盖；仍需微信开发者工具人工验证首页保存默认名后，创建页和加入页默认昵称正确带入。
```

### 2026-06-24 主动操作后整页重新加载影响体验

```text
日期：2026-06-24
来源：human
场景：房间页 / 主动操作 / 多人同步 / 局部渲染
结果：negative
分值：-8
严重度：4
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/room/index.js`：`updateNickname`、`updateMemberScore`、`runBatch`、`submitTransfer`、`undoRecord`、`closeRoom`
- `docs/room-sync-plan.md`：主动操作后的局部更新策略
- `docs/requirements.md`：房间页性能和同步验收要求
问题对应关系：
- 每次主动操作后出现整页“加载中”：对应操作成功后调用 `loadRoom()`，而 `loadRoom()` 会设置 `loading: true`，触发整页 loading 分支。
- 用户期望只更新改动部分：对应同步架构已经有 `rooms`、`room_members`、`score_records` 三个 watcher，可按区域更新，不需要主动操作后整页回拉。
现象：转移等操作成功后页面先显示全页“加载中...”，再回到房间页，造成明显闪烁和重复渲染。
根因或推测：从主动拉取模式迁移到 watch 同步后，旧的操作成功后 `loadRoom()` 逻辑未清理。
处理方式：移除改名、单人加扣、批量加扣、转移、撤销和关闭房间成功后的 `loadRoom()`；保留首次进入和下拉刷新完整加载；操作结果交给 watcher 局部更新。
是否需要新增自动检查或测试：需要人工在微信开发者工具中验证主动操作后不再出现全页 loading，且公共积分池、成员排行和最近记录仍会局部更新。
```

### 2026-06-24 公共积分池在多人房间中未随记录同步

```text
日期：2026-06-24
来源：human
场景：房间页 / 多人同步 / 公共积分池 / 积分转移
结果：negative
分值：-9
严重度：5
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/room/index.js`：`applyRecordsSnapshot`、`getLatestPublicScoreFromRecords`
- `docs/room-sync-plan.md`：`score_records` 局部更新规则
问题对应关系：
- 成员积分和最近记录已经同步，但公共积分池仍显示旧值：对应 `room_members` 和 `score_records` watcher 已生效，而 `rooms` 快照未稳定驱动 `room.publicScore` 展示。
- 转移记录本身包含 `afterSnapshot.room.publicScore`：对应前端可以从记录快照补齐公共积分池的展示同步，不需要客户端直接写数据库。
现象：A 端公共积分池显示 6，B 端同房间仍显示 0；同时 B 端成员分数和最近记录已经出现对应转移记录。
根因或推测：CloudBase `rooms` watcher 在当前开发工具或权限配置下没有及时把房间文档变更推到所有客户端，导致只依赖 `rooms` 快照会出现公共积分池展示滞后。
处理方式：保留 `rooms` watcher 作为主通道，同时在 `score_records` watcher 收到最新记录快照时，从最新带 `afterSnapshot.room.publicScore` 的记录中提取公共积分池当前值并局部更新页面 `room.publicScore`。
是否需要新增自动检查或测试：需要人工在微信开发者工具中验证公共积分池转入、转出、批量转移和撤销后，所有在线客户端的公共积分池、成员排行和最近记录同步一致。
```

### 2026-06-24 房间监听建立后显示同步失败

```text
日期：2026-06-24
来源：human
场景：房间页 / 多人同步 / CloudBase watch / 数据库权限
结果：negative
分值：-9
严重度：5
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `miniprogram/pages/room/index.js`：`startRoomWatchers`、watch 查询条件和错误提示
- `cloudfunctions/scoreFunctions/index.js`：`createRoom`、`joinRoom`、`getRoom`
- `docs/room-sync-plan.md`、`docs/architecture.md`、`docs/requirements.md`：同步机制和权限规则说明
问题对应关系：
- 两个测试号均已进入房间，但房间页显示“同步失败”：对应 CloudBase `watch()` 受集合读权限和安全规则查询子集限制影响。
- 初始房间数据能显示，说明云函数 `getRoom` 可读；实时监听失败，说明客户端直连数据库读权限或监听查询条件不满足安全规则。
现象：房间页能通过云函数加载成员和记录，但同步状态进入失败；不同客户端之间不能通过 `watch()` 及时收到成员加入和积分变化。
根因或推测：此前 `rooms` 监听只按 `_id` 查询，无法配合 `auth.openid in doc.memberOpenids` 这类成员级安全规则；旧房间也缺少 `memberOpenids` 字段，导致安全规则无法判断当前用户是否属于房间。
处理方式：新增并维护 `rooms.memberOpenids`；创建、加入和 `getRoom` 时由云函数写入或回填；房间页 `rooms` watcher 改为 `_id + memberOpenids` 查询；watch 失败时输出具体集合错误，并提示检查权限；文档补充推荐安全规则。
是否需要新增自动检查或测试：需要人工在微信开发者工具中部署云函数并配置 CloudBase 安全规则后，用 A/B 两个测试号验证成员加入、记分、转移和关闭房间是否实时同步。
```

### 2026-06-24 小程序 UI 风格需要贴合黄鸭 icon

```text
日期：2026-06-24
来源：human
场景：首页 / 创建房间 / 加入房间 / 房间页 / 记录页 / UI 主题
结果：positive
分值：+4
严重度：4
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/assets/app-icon.png`：黄鸭记分板 icon 风格参考
- 本轮确认的视觉效果图：已用于确定 UI 方向，后续不作为仓库必需资产保留
- `miniprogram/assets/app-icon.png`：小程序运行时使用的 icon 资源
- `miniprogram/app.wxss`、`miniprogram/app.json`：全局背景和导航色
- `miniprogram/pages/index/index.*`：首页黄鸭品牌卡和三色入口
- `miniprogram/pages/create-room/index.*`：创建页暖色表单主题
- `miniprogram/pages/join-room/index.*`：加入页暖色表单主题
- `miniprogram/pages/room/index.*`：房间页公共积分池、成员排行和记录卡主题
- `miniprogram/pages/records/index.*`：记录页彩色记录卡主题
问题对应关系：
- 用户确认效果图风格符合 icon：对应后续 UI 改动应保持黄鸭、奶油黄、圆润卡片和绿/红/蓝功能色体系。
- 需要把当前小程序 UI 改成效果图风格：对应只改视觉层，不改变云函数 action、数据结构、权限规则或积分流程。
- 历史 UI 反馈多次涉及按钮居中、超界和标题挤压：对应本轮继续保留按钮 flex 居中、公共积分池纵向按钮结构、成员排行标题独占一行。
现象：原页面偏通用工具风，和黄鸭 icon 的可爱、温暖、圆润风格不够一致。
根因或推测：此前视觉系统主要以浅灰、白卡和绿色主按钮为主，只承接了 icon 的加分绿色，没有承接黄鸭品牌主色。
处理方式：先输出并确认效果图；随后把小程序页面主题调整为奶油黄背景、黄鸭品牌元素、圆润卡片、黄色创建入口、绿色确认/加分、红色扣分、蓝色转移/信息。
是否需要新增自动检查或测试：暂不新增自动化。需要微信开发者工具人工验证五个页面无缺失图片、按钮不溢出、文字不竖排、权限入口不被视觉改造误伤。
```

### 2026-06-24 首页默认名编辑流程执行方案 C

```text
日期：2026-06-24
来源：human
场景：首页 / 当前用户信息 / 默认名编辑
结果：positive
分值：+3
严重度：3
置信度：4
影响模块：miniprogram / docs
关联代码位置：
- 首页默认名方案：方案 C 已废弃，当前改为直接可见的默认名输入和保存区
- `miniprogram/pages/index/index.js`：默认名草稿、保存、取消和校验状态
- `miniprogram/pages/index/index.wxml`：身份胶囊和默认名编辑条
- `miniprogram/pages/index/index.wxss`：身份胶囊、编辑条和状态样式
- `miniprogram/pages/create-room/index.wxml`：默认名来源提示
- `miniprogram/pages/join-room/index.wxml`：默认名来源提示
问题对应关系：
- 用户要求开始执行计划：对应按方案 C 实现身份胶囊和默认名编辑流程。
- 名称修改逻辑需要明确触发和保存：对应点击名称或“改”进入编辑态，点击“保存”才写入本地缓存，点击“取消”丢弃草稿。
- 创建和加入页需要说明默认名来源：对应昵称字段下方增加临时修改提示。
现象：此前首页默认名在胶囊内输入即保存，触发、保存和取消状态不明确。
根因或推测：初版只完成数据流，未按交互状态拆分默认名编辑流程。
处理方式：新增 `profileEditing`、`profileDraftName`、`profileOriginalName`、`profileSaving`、`profileError` 状态；首页默认态展示身份胶囊，编辑态展开输入、取消和保存；创建/加入页提示默认名带入但不反写首页。
是否需要新增自动检查或测试：当前通过语法和文案检查覆盖基础质量；仍需微信开发者工具真实预览确认身份胶囊、编辑条、长名称和按钮不溢出、不竖排。
```

### 2026-06-24 房间成员加入和积分变化改为 CloudBase watch 同步

```text
日期：2026-06-24
来源：human
场景：房间页 / 多人同步 / 成员加入 / 积分变化
结果：negative
分值：-8
严重度：5
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：继续作为唯一业务写入口，不再生成额外推送事件
- `miniprogram/pages/room/index.js`：按房间建立 `rooms`、`room_members`、`score_records` 三个数据库 watcher
- `miniprogram/pages/room/index.wxml`、`miniprogram/pages/room/index.wxss`：同步状态展示
- `docs/room-sync-plan.md`、`docs/architecture.md`、`docs/requirements.md`：CloudBase 数据库监听方案和数据结构边界
问题对应关系：
- A 创建房间后停留在房间页，B 加入后 A 不会及时刷新：对应房间页此前只在 `onLoad`、下拉刷新和当前用户自己操作后调用 `loadRoom()`，没有被动同步机制。
- 用户重新决策接受 CloudBase 数据库监听：对应同步边界改为按当前 `roomId` 监听三张核心业务表。
- 多用户同时使用时不能无脑广播或整页重渲染：对应房间页只更新房间、成员、记录三个局部数据区。
现象：其他成员加入、改名、记分、转移或关闭房间时，已在房间页的用户需要手动刷新才能看到变化。
根因或推测：当前架构只有云函数写入和前端主动读取，缺少房间页被动同步。
处理方式：撤销 WebSocket 推送服务接入点和 `room_events` 事件表；房间页初次 `getRoom` 后建立 `rooms`、`room_members`、`score_records` 三个 watcher；页面隐藏或卸载时关闭 watcher；监听异常时提示下拉刷新，不自动轮询。
是否需要新增自动检查或测试：需要。当前已覆盖语法和文案检查；真实同步需在微信开发者工具或真机中用 A、B、C 三个用户人工验证 watcher 生效和关闭时机。
```

### 2026-06-24 首页用户区未先出图且布局失败

```text
日期：2026-06-24
来源：human
场景：首页 / 当前用户信息 / UI 方案确认
结果：negative
分值：-8
严重度：5
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/index/index.wxml`：首页当前用户信息区
- `miniprogram/pages/index/index.wxss`：`.profile-card`、`.avatar-button`、`.profile-sync-button`
- `docs/codex-feedback-log.md`：本次 UI 流程反馈
问题对应关系：
- 首页用户区布局丑且真实预览错位：对应独立三列用户卡片在小屏宽度下挤压，授权按钮超出卡片，头像被拉成椭圆。
- 用户要求先调查并生成几个样式图再定夺：对应 Codex 只给了文字方案描述，没有生成对应图片。
- 随意直接落地 UI 导致减分：对应未先通过可视化方案确认。
现象：真实微信开发者工具预览中，首页“当前用户”竖排，头像区域变形，“微信授权”按钮溢出白色卡片。
根因或推测：对微信小程序按钮默认样式和窄屏横向空间预估不足；UI 决策没有按用户要求先输出图片方案。
处理方式：用户选择方案 C 后，移除独立用户卡片，改为标题区右侧小身份胶囊；最多人数移到副标题旁；主操作卡片回到用户信息下方。
是否需要新增自动检查或测试：暂不新增自动化。后续新增或大改 UI 前，应先生成可视化样式图供用户选择，并用微信开发者工具真实预览验收是否错位、溢出和文字竖排。
```

### 2026-06-24 首页需要展示当前用户和默认名

```text
日期：2026-06-24
来源：human
场景：首页 / 加入房间 / 成员昵称
结果：negative
分值：-4
严重度：3
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/index/index.*`：当前用户信息、微信资料获取、默认名编辑
- `miniprogram/utils/profile.js`：本地用户资料缓存
- `miniprogram/pages/create-room/index.js`：创建房间默认昵称传参
- `miniprogram/pages/join-room/index.js`：加入房间默认昵称传参
- `docs/requirements.md`、`docs/architecture.md`：首页用户信息和默认名规则
问题对应关系：
- 首页不知道当前默认使用什么昵称：对应首页缺少清晰的默认名设置和展示。
- 每个用户需要默认名：对应本地 `userProfile.defaultName` 缓存。
- 加入房间应默认使用该名称：对应创建页和加入页初始化昵称并向云函数传递。
现象：用户进入首页后无法确认当前身份，加入房间时需要重复输入昵称。
根因或推测：此前昵称只存在创建/加入表单中，未沉淀为首页级本地用户偏好。
处理方式：新增首页默认名设置和本地资料工具；创建和加入房间默认带入首页默认名。后续简化为不处理头像，不传递头像字段。
是否需要新增自动检查或测试：当前通过语法检查覆盖；需要微信开发者工具人工验证默认名保存、创建和加入房间默认昵称。
```

### 2026-06-24 编辑 icon 多次未命中后改为文字按钮

```text
日期：2026-06-24
来源：human
场景：房间页 UI / 成员昵称改名入口
结果：negative
分值：-9
严重度：5
置信度：5
影响模块：miniprogram
关联代码位置：
- `miniprogram/pages/room/index.wxml`：`.name-edit-button`
- `miniprogram/pages/room/index.wxss`：`.name-edit-button`
问题对应关系：
- icon 形式连续与效果图和真实预览不一致：对应此前用 CSS 绘制图标并依赖小程序渲染，位置和尺寸难以稳定命中。
- 用户明确改为文字形式：对应昵称旁入口改成“改名”小文字按钮。
现象：编辑 icon 的位置和大小多次偏离效果图 A，真实预览体验不达标。
根因或推测：图标方案在当前小程序页面中对尺寸和位置要求高，且 Codex 未通过真实开发者工具截图闭环验证，导致连续误差。
处理方式：取消图标方案，改为稳定的“改名”文字按钮，保留轻量胶囊样式和云函数一次性改名逻辑。
是否需要新增自动检查或测试：暂不新增自动化。需要微信开发者工具人工确认文字按钮位置、大小和点击区域。
```

### 2026-06-24 编辑 icon 效果图与真实小程序渲染不一致

```text
日期：2026-06-24
来源：human
场景：房间页 UI / 成员昵称改名入口
结果：negative
分值：-8
严重度：5
置信度：5
影响模块：miniprogram
关联代码位置：
- `miniprogram/pages/room/index.wxml`：昵称旁编辑入口承载元素
- `miniprogram/pages/room/index.wxss`：`.name-edit-icon`、`.edit-icon-core`、`.edit-icon-body`、`.edit-icon-point`
问题对应关系：
- 效果图 A 已明确 icon 应贴近昵称，但真实小程序中位置偏到成员卡片中部：对应继续使用原生 `button` 导致微信默认按钮布局行为影响真实渲染。
- icon 左右出现异物：对应把一个完整编辑图标拆成多个 CSS 片段，片段在真实渲染中被拉散。
- icon 大小与效果图不一致：对应没有按效果图 A 的视觉尺寸换算到 rpx。
现象：真实预览里编辑 icon 不贴近 `pc` 昵称，位置和效果图 A 明显不一致，且首次修复后仍残留尺寸偏差。
根因或推测：Codex 只按 Web 效果图推断，没有充分考虑微信小程序 `button` 默认样式和 WXML 真实渲染差异；用 CSS 片段模拟图标的方式稳定性不足。
处理方式：编辑入口从 `button` 改为 `view` 点击区，避开原生按钮默认样式；图标改为一个集中定位的核心容器，视觉尺寸调整为接近效果图 A。
是否需要新增自动检查或测试：暂不新增自动化。后续 UI 效果图落地到小程序时，必须优先使用和效果图一致的结构，并在微信开发者工具真实预览中核对位置和尺寸。
```

### 2026-06-24 房间 24 小时过期后仍需保留 7 天只读数据

```text
日期：2026-06-24
来源：human
场景：房间进入 / 数据生命周期 / 过期只读查看
结果：negative
分值：-7
严重度：5
置信度：5
影响模块：scoreFunctions / miniprogram / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：`createRoom` 写入 `purgeAt`，`cleanupExpiredRooms` 改按 7 天保留期清理
- `miniprogram/pages/room/index.js`、`miniprogram/pages/room/index.wxml`：过期房间仍可展示云端返回的房间、成员和记录数据，写操作入口由 `room.status === 'active'` 控制
- `docs/requirements.md`、`docs/architecture.md`、`docs/codex-workflow.md`：生命周期从“24 小时删除”调整为“24 小时只读、7 天删除”
问题对应关系：
- 房间最多存活 24 小时：对应 `expireAt`，超过后不能加入、记分、转移、撤销、关闭或改名。
- 云端数据保存 7 天：对应新增 `purgeAt`，清理函数只删除超过 7 天保留期的数据。
- 换手机也可以查看云端数据：对应房间详情始终从 `getRoom` 拉取云端 `rooms`、`room_members`、`score_records`，本地缓存只作为入口。
现象：如果按上一版 `expireAt <= 当前时间` 物理删除，24 小时后用户无法再进入房间查看结果和记录，不符合“房间不可操作但数据仍可查看”的预期。
根因或推测：此前把“房间存活期”和“数据保留期”合并成同一个 `expireAt`，缺少独立的物理清理时间字段。
处理方式：新增 `purgeAt = 创建时间 + 7 天`；`expireAt` 继续控制 active 到 expired；`cleanupExpiredRooms` 优先按 `purgeAt` 清理，旧数据按 `expireAt + 6 天` 兼容；文档同步只读查看和 7 天保留规则。
是否需要新增自动检查或测试：需要人工在微信开发者工具验证过期房间可进入查看但所有写操作入口不可用；可通过构造过期未到 `purgeAt` 的测试数据和超过 `purgeAt` 的测试数据分别验证。
```

### 2026-06-24 本地历史房间与云端清理不一致、成员需要一次改名机会

```text
日期：2026-06-24
来源：human
场景：房间进入 / 数据生命周期 / 成员昵称
结果：negative
分值：-6
严重度：4
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `miniprogram/utils/api.js`：保留云函数错误码，便于区分云端房间不存在
- `miniprogram/pages/room/index.js`：房间加载失败状态、成员改名入口和 `updateNickname` 调用
- `miniprogram/pages/room/index.wxml`：本人昵称旁编辑 icon 按钮
- `miniprogram/pages/room/index.wxss`：编辑 icon 和房间不可用状态样式
- `cloudfunctions/scoreFunctions/index.js`：`updateNickname`、`room_members.nicknameEdited`
- `docs/requirements.md`、`docs/architecture.md`：改名机会、本地缓存和清理边界说明
问题对应关系：
- 本地 `recentRooms` 可能和云数据库不一致：对应过期清理只删除云数据库，不清理小程序本地缓存；前端进入已清理房间时需要提示而不是假定房间仍存在。
- 玩家进入后需要一次改名机会：对应 `room_members.nicknameEdited` 字段和云函数 `updateNickname` 校验。
- 有改名机会时名字旁应显示编辑 icon：对应房间页成员卡片只在当前成员本人且未改名时显示 icon 按钮。
现象：过期房间被云端清理后，本地历史入口仍可能保留；用户还需要在加入房间后修正一次自己的显示昵称。
根因或推测：本地缓存和云数据库生命周期不同步是预期行为，但页面缺少针对云端房间不存在的状态；成员昵称此前只在创建或加入时设置，没有后续一次性修改能力。
处理方式：新增 `updateNickname` action，成员只能修改自己昵称一次，房主改名同步 `ownerNickname`；房间页本人昵称旁显示纯 icon 编辑按钮；云端房间不存在时显示房间不可用状态，不删除本地最近房间缓存。
是否需要新增自动检查或测试：当前通过 `node --check` 覆盖语法，通过人工在微信开发者工具验证 stale 最近房间入口、改名一次成功、第二次隐藏入口或后端拒绝。
```

### 2026-06-24 扫码加入二维码和房间清理策略缺失

```text
日期：2026-06-24
来源：human
场景：加入房间 / 分享 / 数据生命周期
结果：negative
分值：-7
严重度：4
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `miniprogram/pages/index/index.js`：`scanJoin`
- `miniprogram/pages/room/index.*`：房间二维码入口和弹窗
- `miniprogram/utils/qrcode.js`：房间码二维码矩阵生成
- `cloudfunctions/scoreFunctions/index.js`：`cleanupExpiredRooms`
- `cloudfunctions/scoreFunctions/config.json`：`cleanupExpiredRooms` 定时触发器
- `docs/requirements.md`、`docs/architecture.md`、`docs/cloudbase-access.md`、`docs/codex-workflow.md`：扫码、二维码和清理策略
问题对应关系：
- 首页有扫码入口但房间内没有可被扫描的二维码：对应房间页缺少二维码弹窗。
- 数据库会持续持久化历史房间数据：对应缺少过期数据清理动作和定时触发器。
- 房间最长存活应为 24 小时：对应需求和架构需要明确 `expireAt` 是清理依据。
现象：用户准备真实使用扫码加入时，房间页没有二维码可展示；同时担心云数据库长期堆积房间、成员和记录数据。
根因或推测：此前只实现了扫码解析和房间 `expireAt` 校验，没有实现房间码二维码展示，也没有实现物理清理策略。
处理方式：房间页新增“二维码”按钮和房间码二维码弹窗；首页扫码入口继续识别房间码；云函数新增 `cleanupExpiredRooms`，按 `expireAt <= 当前时间` 删除房间、成员和操作记录；新增每小时定时触发器配置和 CLI 创建命令；文档同步最长存活 24 小时策略。
是否需要新增自动检查或测试：需要人工验收二维码在微信开发者工具或真机上可被首页扫码入口识别；清理函数可通过 CLI 手动调用低 limit 验证，但线上执行前应确认不会误删未过期数据。
```

### 2026-06-23 成员排行按钮挤压标题

```text
日期：2026-06-23
来源：human
场景：房间页 UI / 批量操作入口
结果：negative
分值：-9
严重度：5
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/room/index.wxss`：`.section-head`、`.section-tools`、`.batch-toggle`、`.transfer-toggle`
问题对应关系：
- 缩短按钮后仍挤压“成员排行”：对应按钮和标题仍放在同一横向布局中。
- 用户目标是按钮缩短并在同一排，同时不挤压标题：对应标题应独占一行，按钮在下一行同排右对齐。
现象：缩短后的“批量转移”和“批量”仍与“成员排行”共享横向空间，导致标题区域受挤压。
根因或推测：上一版只调整了按钮宽度，没有改变父容器横向布局，误解了“放一排”的对象是两个按钮之间，而不是按钮与标题之间。
处理方式：成员排行头部改为纵向布局，标题独占一行，两个缩短按钮在下一行同排右对齐。
是否需要新增自动检查或测试：暂不新增自动化。需要微信开发者工具人工验收“成员排行”完整横排显示，两个按钮在下一行同排。
```

### 2026-06-23 公共积分池按钮三次布局未命中

```text
日期：2026-06-23
来源：human
场景：转移 / 房间页 UI
结果：negative
分值：-10
严重度：5
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/room/index.wxml`：公共积分池操作按钮、非房主成员转移按钮
- `miniprogram/pages/room/index.wxss`：`.public-transfer-row`、`.public-transfer-button`、`.public-share-button`、`.compact-transfer`
问题对应关系：
- 公共池按钮看起来分不开：对应三按钮同一行视觉层级不清晰，且小程序真实预览中按钮像一条连续带。
- 公共池按钮仍然超宽：对应上一版使用 grid 和整行三列，真实预览仍出现超出卡片边界。
- 非房主转移按钮太宽：对应只有一个“转”按钮时 `.score-action` 仍 `flex: 1` 占满整行。
现象：真实预览中公共积分池按钮仍然像一条连在一起的按钮带，并且右侧超出绿色卡片；非房主成员卡片中的“转”按钮横向占满，和房主看到的单个转移按钮不一致。
根因或推测：微信小程序 button 默认样式和 grid 布局组合在真机/开发者工具中表现不稳定；单按钮场景沿用了三按钮容器的 `flex: 1`。
处理方式：公共池按钮改为两层结构：第一层左右分离的“转入/转出”，第二层独立“分享房间”；不再使用 grid；非房主“转”按钮增加 `compact-transfer`，按三按钮中的单个按钮宽度显示。
是否需要新增自动检查或测试：需要人工重点验收。后续公共积分池按钮布局必须以真实微信开发者工具截图为准，不能只按代码推断。
```

### 2026-06-23 公共积分池按钮二次超宽

```text
日期：2026-06-23
来源：human
场景：转移 / 房间页 UI
结果：negative
分值：-8
严重度：4
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/room/index.wxml`：公共积分池按钮行
- `miniprogram/pages/room/index.wxss`：`.score-panel`、`.score-panel-actions`、`.public-action-row`
问题对应关系：
- 公共积分池按钮仍然超宽：对应按钮仍在公共积分池卡片右侧同一行，与分数抢横向空间。
- 只有一个转入按钮可见：对应右侧固定宽度和微信 button 默认宽度叠加后导致按钮被裁切。
现象：真实预览中公共积分池区域仍只能看到一个“转入”按钮，转出入口不可见。
根因或推测：上一轮把按钮压缩在右侧固定宽度内，但小程序 button 默认样式和卡片横向布局仍会造成裁切；该区域不适合做右侧按钮组。
处理方式：公共积分池卡片改为纵向布局，上方只展示标题和分数，下方使用整行三列按钮“转入 / 转出 / 分享”，避免任何按钮与分数争抢横向空间。
是否需要新增自动检查或测试：暂不新增自动化，必须在微信开发者工具人工验收三个按钮都完整可见且不超出绿色卡片。
```

### 2026-06-23 公共积分池转移按钮超宽和转出缺失

```text
日期：2026-06-23
来源：human
场景：转移 / 房间页 UI
结果：negative
分值：-8
严重度：4
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/room/index.wxml`：公共积分池操作按钮、成员排行工具区、转移弹窗文案
- `miniprogram/pages/room/index.js`：`openTransferToPublicDialog`、`openTransferFromPublicDialog`、`submitTransfer`
- `miniprogram/pages/room/index.wxss`：`.score-panel-actions`、`.public-action-row`、`.section-tools`
- `docs/requirements.md`、`docs/architecture.md`：公共积分池转入/转出和布局要求
问题对应关系：
- 公共积分池按钮超宽：对应右侧按钮组宽度和按钮默认宽度未压紧。
- 成员排行标题被挤成竖排：对应成员排行工具按钮和标题共用同一横向空间。
- 只有转入公共，没有从公共转出：对应公共积分池区域只实现当前用户转入公共积分池，漏掉公共积分池转给当前用户。
现象：真实预览中公共积分池右侧按钮超出绿色卡片边界，成员排行标题被挤压换行成竖排，公共积分池缺少“转出”操作。
根因或推测：公共区域沿用了完整按钮文案和固定宽度；成员排行头部同时放置“批量转移”和“批量”两个按钮；上一版只按“默认从自己转出”处理，忽略公共积分池本身需要双向操作。
处理方式：公共积分池按钮改为紧凑两列“转入/转出”，分享按钮独占一行；成员排行工具区换到标题下方，避免挤压标题；新增从公共积分池转给当前用户的弹窗入口。
是否需要新增自动检查或测试：暂不新增自动化。需要微信开发者工具人工验收：公共卡片按钮不超界，成员排行标题横排显示，公共积分池可转入和转出。
```

### 2026-06-23 转移入口需要融合进成员排行

```text
日期：2026-06-23
来源：human
场景：转移 / 房间页交互 / 本地服务
结果：negative
分值：-9
严重度：4
置信度：5
影响模块：miniprogram / docs / local-server
关联代码位置：
- `miniprogram/pages/room/index.wxml`：成员排行内转移按钮、批量转移模式、公共积分池转入入口
- `miniprogram/pages/room/index.js`：`openMemberTransferDialog`、`openPublicTransferDialog`、`openBatchTransferDialog`、`submitTransfer`
- `miniprogram/pages/room/index.wxss`：`.transfer-toggle`、`.public-transfer-button`、`.transfer`
- `docs/requirements.md`、`docs/architecture.md`：转移入口和默认来源规则
问题对应关系：
- 独立积分转移区不符合预期：对应房间页单独展示来源和目标选择区。
- 转移入口应融合进成员排行：对应成员卡片直接转给目标成员、成员排行批量转移模式。
- 默认都应从自己转出：对应前端不再提供来源选择，只提交 `fromType: member` 和当前用户 `currentMemberId`。
- 公共池子应在公共区域操作：对应公共积分池面板内“转入公共”按钮。
- Codex 测试启动本地服务后未停止：对应开发流程要求，测试后必须停止本地服务并提醒人工重新启动。
现象：上一版转移区仍像独立表单，入口与成员排行割裂；本地服务被后台进程占用导致人工手动启动反复遇到 `EADDRINUSE`。
根因或推测：为了支持多来源转移，前端暴露了过多操作路径；Codex 为接口测试后台启动本地服务后没有在最终阶段释放端口。
处理方式：移除独立转移区；成员卡片加入单目标转移按钮；成员排行加入批量转移模式；公共积分池面板加入转入公共按钮；后续本地服务测试必须测试后停止，并明确提醒需要人工重新启动。
是否需要新增自动检查或测试：需要。后续应补充 UI 人工验收项：转移入口不再出现独立区域、成员卡片可直接转移、批量转移可用、公共入口在公共积分池区域。本地服务端口占用可通过流程约束执行。
```

### 2026-06-23 转移目标点击和批量转移

```text
日期：2026-06-23
来源：human
场景：转移 / 房间页交互
结果：negative
分值：-7
严重度：4
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `miniprogram/pages/room/index.js`：`selectTransferSource`、`openTransferDialog`、`toggleTransferTarget`、`submitTransfer`
- `miniprogram/pages/room/index.wxml`：积分转移目标按钮和转移弹窗
- `miniprogram/pages/room/index.wxss`：`.transfer-source`、`.transfer-target`、`.transfer-dialog`
- `cloudfunctions/scoreFunctions/index.js`：`batchTransferScore`
- `local-server/server.js`：本地 `batchTransferScore`
- `docs/requirements.md`、`docs/architecture.md`：批量转移 action 和事务规则
问题对应关系：
- 转移操作不方便：对应房间页原来需要在两个 picker 中选择来源和目标，再输入分值。
- 需要直接点击目标后弹窗转移：对应前端目标按钮和自定义转移弹窗。
- 需要批量转移多个目标：对应云函数新增事务型 `batchTransferScore`，不能由前端循环调用单次转移。
现象：用户在活动场景中希望更快地选择转入目标，并在同一来源下批量转给多个成员或公共积分池。
根因或推测：picker 适合少量表单项，但不适合房间内频繁选择成员目标；批量目标如果由前端多次调用，可能在中途失败时产生部分成功。
处理方式：房间页转移区改为来源按钮和目标按钮；点击目标打开弹窗，弹窗内支持多选目标并输入每个目标分值；云函数和本地服务新增 `batchTransferScore`，一次事务完成所有积分变化和记录写入。
是否需要新增自动检查或测试：需要。后续应补充转移单元测试，覆盖公共积分转多个成员、成员转多个成员、成员转公共积分加成员、普通成员权限限制和撤销批量转移。
```

### 2026-06-23 最近记录分页

```text
日期：2026-06-23
来源：human
场景：记录查看 / 房间页最近记录
结果：negative
分值：-4
严重度：3
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/room/index.js`：`buildRecentRecordPageState`、`changeRecentRecordPage`
- `miniprogram/pages/room/index.wxml`：最近记录分页控件
- `miniprogram/pages/room/index.wxss`：`.record-pager`、`.pager-button`、`.pager-text`
- `docs/requirements.md`、`docs/architecture.md`：最近记录分页要求
问题对应关系：
- 房间页最近记录一次性展示过多：对应前端直接渲染接口返回的全部最近记录。
- 用户要求每页 5 条：对应房间页需要保留完整记录列表并派生当前页展示列表。
现象：最近记录区域会随记录数量增长，占用房间页过多空间。
根因或推测：此前只提供“全部”入口，没有对房间页局部记录列表做分页控制。
处理方式：房间页新增最近记录分页状态，每页展示 5 条，超过 5 条时显示上一页/下一页；刷新或操作后回到第一页；完整记录页保持最近 50 条展示。
是否需要新增自动检查或测试：暂不新增。当前通过 `node --check` 和微信开发者工具人工验收覆盖分页展示和按钮禁用状态。
```

### 2026-06-23 最近记录缺少操作人

```text
日期：2026-06-23
来源：human
场景：记录查看 / 房间页最近记录
结果：negative
分值：-5
严重度：4
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/room/index.js`：`formatRecord`
- `miniprogram/pages/room/index.wxml`：最近记录卡片
- `miniprogram/pages/room/index.wxss`：`.record-operator`
- `miniprogram/pages/records/index.js`、`miniprogram/pages/records/index.wxml`：记录页统一操作人展示字段
- `docs/requirements.md`、`docs/architecture.md`：记录展示要求
问题对应关系：
- 用户需要知道是谁操作的：对应记录展示层没有在房间页最近记录中展示 `operatorNickname`。
- 记录页和房间页展示不一致：对应格式化结果没有统一 `displayOperator` 字段。
现象：完整记录页已有操作人行，但房间页最近记录只展示类型、对象、分值和时间，用户不能在第一屏追溯操作来源。
根因或推测：后端记录已写入 `operatorOpenid/operatorNickname`，问题集中在前端最近记录卡片未展示字段。
处理方式：记录格式化增加 `displayOperator`；房间页最近记录显示“操作人”；记录页改为复用同一展示字段；需求和架构补充房间页最近记录也必须展示操作人。
是否需要新增自动检查或测试：暂不新增。当前通过 `node --check` 和微信开发者工具人工验收覆盖展示，后续如增加记录格式化单元测试，应纳入操作人字段。
```

### 2026-06-23 指定撤销覆盖后续分数严重问题

```text
日期：2026-06-23
来源：human
场景：撤销 / 记录查看 / 数据一致性
结果：negative
分值：-10
严重度：5
置信度：5
影响模块：scoreFunctions / miniprogram / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：`undoLastAction`
- `local-server/server.js`：`undoLastAction`
- `miniprogram/pages/room/index.js`、`miniprogram/pages/records/index.js`：撤销记录流向展示
- `docs/requirements.md`、`docs/architecture.md`、`docs/codex-workflow.md`：撤销一致性规则和本地服务重启要求
问题对应关系：
- 指定撤销旧记录时分数错误：对应云函数和本地模拟服务直接用原记录 `beforeSnapshot` 覆盖当前分数。
- 后续记录被破坏：对应撤销未按原记录差值做反向增量更新。
- 撤销记录展示方向可能不准：对应前端用旧 `targets` 推断撤销流向，而不是优先看撤销记录自身快照。
现象：本地记录中，撤销一条较早的批量加分后，成员后续单独加过的分数也被抹掉；当前积分和操作记录链条不一致。首次修复代码后再次操作仍出错，排查发现微信开发者工具仍访问未重启的旧本地服务进程。
根因或推测：最初“撤销最近一次”的实现可以近似恢复旧快照，但升级为“撤销指定记录”后，旧快照覆盖会和后续操作冲突；本地模拟服务变更后未强制重启，导致已修复代码未生效。
处理方式：撤销改为基于原记录 `beforeSnapshot` 与 `afterSnapshot` 的差值，对当前公共积分和成员积分执行反向增量；新增撤销记录保存撤销前当前状态和撤销后状态；前端撤销记录流向优先根据撤销记录自身快照展示；重启本地服务并修复已被旧逻辑污染的当前测试分数；流程文档加入本地服务变更后必须重启验证。
是否需要新增自动检查或测试：需要。后续应补充自动测试：先对成员加 5，再加 2，撤销第一条后成员应为 2；批量和公共积分转移也应覆盖同类差值逻辑。
```

### 2026-06-23 记录流向、全部入口和多人测试反馈

```text
日期：2026-06-23
来源：human
场景：记录查看 / 转移 / 本地多人测试 / 房间页按钮
结果：negative
分值：-6
严重度：4
置信度：5
影响模块：miniprogram / docs
关联代码位置：
- `miniprogram/pages/room/index.js`：`formatRecord`、记录目标展示和当前用户视角
- `miniprogram/pages/records/index.js`：记录页目标展示和当前用户视角
- `miniprogram/pages/room/index.wxml`、`miniprogram/pages/room/index.wxss`：最近记录“全部”入口样式
- `miniprogram/utils/api.js`、`miniprogram/pages/index/index.*`：本地模拟 openid 切换
- `docs/requirements.md`、`docs/architecture.md`：记录流向和本地多人测试说明
问题对应关系：
- 转移记录只能看出公共积分转入或转出，不能明确“从哪里到哪里”：对应记录格式化逻辑。
- 不同成员查看同一条记录应有不同视角：对应当前成员显示为“我”的记录展示规则。
- 最近记录区“全部”入口视觉弱：对应房间页该按钮的独立样式。
- 开发阶段需要多人加入测试办法：对应本地模拟 openid 切换和真实微信账号体验版验证说明。
现象：记录虽然颜色更明显，但用户仍不能直接理解积分流向；“全部”入口没有被单独强化；开发阶段多人测试路径不清晰。
根因或推测：记录展示仍在拼目标列表，没有利用 `beforeScore/afterScore` 推断来源和去向；本地模拟服务已有 openid 能力，但小程序端没有切换入口。
处理方式：记录展示改为根据积分变化推断“来源 → 去向”；当前用户相关目标显示为“我”；首页本地模式增加开发测试身份切换；最近记录“全部”入口增强可点击样式。
是否需要新增自动检查或测试：需要后续补充记录格式化单元测试。当前先通过 `node --check` 和微信开发者工具人工验证覆盖。
```

### 2026-06-23 单人加扣分和批量入口 UI 命中目标

```text
日期：2026-06-23
来源：human
场景：房间页 / 单人记分 / 批量记分
结果：positive
分值：+5
严重度：3
置信度：5
影响模块：miniprogram
关联代码位置：
- `miniprogram/pages/room/index.wxml`：成员卡片操作区、批量入口
- `miniprogram/pages/room/index.wxss`：`.score-action`、`.batch-toggle`、`.batch-button`
问题对应关系：
- 单人加扣分按钮达到目标 UI：后续不要无说明削弱按钮尺寸、颜色和卡片内布局。
- 批量入口达到目标 UI：后续保留明确可点击状态。
现象：用户确认当前加扣分和批量入口达到了目标 UI。
根因或推测：成员卡片拆成信息行和操作行，并增强按钮色彩和状态后，真实预览中的可点击感更明确。
处理方式：作为后续视觉保持约束记录。
是否需要新增自动检查或测试：暂不需要，继续由微信开发者工具视觉验收覆盖。
```

### 2026-06-23 房间页记分按钮、记录颜色和指定撤销反馈

```text
日期：2026-06-23
来源：human
场景：房间页 / 单人记分 / 批量记分 / 记录查看 / 撤销
结果：negative
分值：-8
严重度：4
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `miniprogram/pages/room/index.wxml`：成员卡片操作区、最近记录列表、撤销入口
- `miniprogram/pages/room/index.wxss`：成员卡片、加扣分按钮、批量入口、记录颜色、撤销按钮
- `miniprogram/pages/room/index.js`：记录格式化、分值符号、指定记录撤销
- `miniprogram/pages/records/index.*`：记录页颜色和指定记录撤销
- `cloudfunctions/scoreFunctions/index.js`：`undoLastAction` 的 `recordId` 参数兼容
- `docs/requirements.md`、`docs/architecture.md`：撤销行为说明
问题对应关系：
- 单人加扣分不明显且按钮可能超界：对应房间页成员卡片布局和按钮样式。
- 加减积分记录缺少颜色区分：对应最近记录和记录页的记录类型色条、分值符号和颜色。
- 批量入口颜色不清晰，容易被理解为不可按：对应房间页批量按钮的可点击状态样式。
- 撤销只能撤销最近一条，不符合用户期望：对应前端未传 `recordId`，后端虽已支持但入口未暴露。
现象：真实预览中成员行横向空间不足，扣分按钮被挤到边界；记录列表无法快速区分加分和扣分；批量入口视觉弱；房主无法直接选择历史记录撤销。
根因或推测：成员卡片把昵称、分数、两个操作按钮放在同一行；记录展示未从操作类型派生视觉状态；前端撤销入口仍沿用“最近操作”按钮，没有使用云函数已有的 `recordId` 能力。
处理方式：成员卡片改为信息行和操作行；加扣分、分数和记录增加正负/类型颜色；批量入口增强可点击样式；房间页和记录页为可撤销记录提供指定撤销按钮，并传入 `recordId`。
是否需要新增自动检查或测试：暂不新增自动化。该问题主要为微信小程序视觉和交互体验，需在微信开发者工具中复验按钮不超界、颜色可辨识和指定撤销流程。
```

### 2026-06-23 界面预览与真实体验偏差

```text
日期：2026-06-23
来源：human
场景：首页 / 创建房间 / 权限操作 / 文案布局
结果：negative
分值：-8
严重度：4
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `miniprogram/pages/index/index.wxss`：`.primary-button`、`.secondary-button`、`.ghost-button`
- `miniprogram/pages/create-room/index.wxss`：`.submit`
- `miniprogram/pages/join-room/index.wxss`：`.submit`
- `miniprogram/pages/room/index.wxss`：`.copy-button`、`.share-button`、`.text-button`、`.mini-button`、`.batch-button`、`.footer-button`、`.transfer-button`
- `miniprogram/pages/room/index.wxml`：积分转移区显示条件和 picker 数据源
- `miniprogram/pages/room/index.js`：`buildTransferOptions`、`onTransferPicker`、`submitTransfer`
- `cloudfunctions/scoreFunctions/index.js`：`getActiveRoomForParticipant`、`assertTransferPermission`、`transferScore`
- `docs/requirements.md`、`docs/architecture.md`、`docs/codex-workflow.md`、`AGENTS.md`：权限和验收规则
问题对应关系：
- 按钮文字未居中、按钮宽度与预览不一致：对应各页面 WXSS 的按钮类。
- 普通成员无法按期望进行受限转移：对应房间页 WXML/JS 的转移入口和云函数 `transferScore` 权限校验。
- 创建房间页面显示异常：对应 `miniprogram/app.json` 页面注册、`miniprogram/pages/create-room/index.*` 页面文件和微信开发者工具缓存状态。
- 文档规则与新权限模型不一致：对应需求、架构、工作流和项目规则文档。
现象：真实小程序界面与 Codex 生成预览图有明显差距，用户更倾向预览图；创建房间点击后页面无法正常显示；实际按钮文字存在居中和宽度问题；权限期望为房主可操作所有成员记分，普通成员可将自己的积分转给他人或公共积分池，也可从公共积分池取给自己。
根因或推测：按钮未显式设置 100% 宽度和 flex 居中，微信 button 默认样式导致实际效果偏离；权限文档和云函数实现原本限制所有积分转移均需房主；创建页异常需在微信开发者工具中清缓存或重新编译后复验。
处理方式：修正按钮宽度和居中样式；调整房间页普通成员转移入口；云函数增加参与者转移权限校验；同步需求、架构和验收文档。
是否需要新增自动检查或测试：需要。后续应增加云函数权限测试，覆盖房主全量操作、普通成员受限转移、普通成员禁止加扣分/批量/撤销/关闭。
```

### 2026-06-23 创建页异常判断正确

```text
日期：2026-06-23
来源：human
场景：创建房间 / 微信开发者工具预览
结果：positive
分值：+4
严重度：3
置信度：5
影响模块：miniprogram / config
关联代码位置：
- `miniprogram/app.json`：`pages/create-room/index` 页面注册
- `miniprogram/pages/index/index.js`：`goCreate`
- `miniprogram/pages/create-room/index.wxml`
- `miniprogram/pages/create-room/index.json`
- `project.config.json`：微信开发者工具编译配置
问题对应关系：
- 点击创建房间后页面内容未更新：优先检查路由注册和 `goCreate` 跳转目标；代码正确时再判断微信开发者工具缓存或未刷新。
- 创建页标题或表单缺失：对应 `create-room/index.wxml` 和页面 JSON 标题配置。
现象：创建房间页面一度无法显示正确页面内容，后确认是微信开发者工具未刷新导致，并非页面路由或页面文件错误。
根因或推测：开发者工具缓存或模拟器未重新编译会导致旧页面状态残留。
处理方式：Codex 先检查 `app.json`、页面路径和页面文件，再提示清缓存或重新编译，判断方向正确。
是否需要新增自动检查或测试：暂不需要。后续遇到类似页面内容不更新问题，应先区分代码配置错误和开发者工具缓存问题。
```

### 2026-06-23 按钮文字居中修复命中目标

```text
日期：2026-06-23
来源：human
场景：首页 / 创建房间 / 加入房间 / 房间页按钮
结果：positive
分值：+5
严重度：3
置信度：5
影响模块：miniprogram
关联代码位置：
- `miniprogram/pages/index/index.wxss`：`.primary-button`、`.secondary-button`、`.ghost-button`
- `miniprogram/pages/create-room/index.wxss`：`.submit`
- `miniprogram/pages/join-room/index.wxss`：`.submit`
- `miniprogram/pages/room/index.wxss`：`.copy-button`、`.share-button`、`.text-button`、`.mini-button`、`.batch-button`、`.footer-button`、`.transfer-button`
问题对应关系：
- 按钮文字居中修复命中目标：对应 `display: flex`、`align-items: center`、`justify-content: center`、`line-height: 1`。
- 按钮宽度更接近预览图：对应 `width: 100%` 和清除默认左右 margin。
现象：首页、创建房间等按钮中文字已经居中，修复符合目标。
根因或推测：微信小程序 `button` 默认样式会影响宽度和文字垂直居中，显式设置 `width: 100%`、`display: flex`、`align-items: center`、`justify-content: center` 能稳定修复。
处理方式：后续新增按钮或修复按钮对齐时优先沿用当前样式策略。
是否需要新增自动检查或测试：暂不需要。后续可在人工视觉验收中继续检查按钮宽度和文字居中。
```
### 2026-06-25 待开发功能先出效果图后落地

```text
日期：2026-06-25
来源：human
场景：首页 / 创建房间 / 房间页 / 成员管理 / UI 确认流程
结果：positive
分值：+4
严重度：4
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `tmp/待开发功能.md`：本轮需求来源
- `tmp/待开发功能效果图.html`、`tmp/待开发功能效果图.png`：确认用效果图
- `cloudfunctions/scoreFunctions/index.js`：成员顺序、重名校验、加入审批、移出成员和记录类型
- `miniprogram/pages/index/*`、`miniprogram/pages/create-room/*`、`miniprogram/pages/join-room/*`、`miniprogram/pages/room/*`：头像、审批开关、待确认卡、本人高亮和移出状态
问题对应关系：
- 用户要求先理解需求并出效果图确认：对应本轮先生成静态效果图，用户确认后再改正式代码。
- 成员展示不能按积分重排：对应成员列表固定按进入顺序展示。
- 本人卡片难以识别：对应本人卡片使用浅绿色背景和“我”标记。
- 房主需要管理加入和移出成员：对应新增加入审批、待确认卡、移出成员状态和记录。
处理方式：效果图确认后再做正式实现；涉及行为、字段、action 和约束变化时同步更新 `docs/requirements.md` 与 `docs/architecture.md`。
是否需要新增自动检查或测试：需要微信开发者工具人工验证审批加入、拒绝加入、移出成员、被移出成员灰态展示、成员顺序不随积分变化、同名拦截和本人高亮。
```

### 2026-06-25 多人同步连续不一致

```text
日期：2026-06-25
来源：human
场景：房间页 / 多账号同步 / 加入审批 / 移出成员
结果：negative
分值：-10
严重度：5
置信度：5
影响模块：scoreFunctions / miniprogram / docs
关联代码位置：
- `cloudfunctions/scoreFunctions/index.js`：`refreshRoomView`、`getRoom`、`reviewJoinRequest`、`removeMember`
- `miniprogram/pages/room/index.js`：`startRoomWatchers`、`applyRoomViewData`、`applyWriteResult`、`applyRoomInboxSnapshot`
- `docs/cloudbase-access.md`：云函数部署和线上源码确认流程
问题对应关系：
- 房主端“暂不加入”后本人页面不刷新：线上云函数仍返回旧结构，没有 `roomView`，操作端无法直接应用最新读模型。
- 申请加入、同意加入、移出成员在其他客户端不同步：线上云函数没有写 `room_inboxes`，客户端轻量失效通知链路实际不存在。
- 历史房间即使部署新版后也可能缺少 inbox：`getRoom` 旧逻辑只在 `room_views` 缺失时修复，没有检查 `room_views.sequence` 和当前用户 inbox。
- 部署命令显示成功但线上源码未变：之前只看部署状态，没有检查 `fn detail` 中的 `CodeInfo` 关键标记。
现象：多账号调试中，房主需要刷新后才看到加入申请；拒绝申请后房主端仍显示待确认；被同意或移出的成员端也不能及时更新。
根因或推测：根因已确认。18:41 的线上日志中 `reviewJoinRequest` 返回 `{"success":true,"memberId":...,"approved":false}`，不带 `roomView`；18:47 的 `fn code update` 最终 `UpdateFailed`，18:54 从项目根目录 `fn deploy --dir cloudfunctions/scoreFunctions` 虽显示成功但线上源码仍为旧版。18:56 起改为在函数目录内执行 `fn deploy --force --dir .` 后，线上源码才包含 `room_inboxes` 和 `roomView` 返回。
处理方式：重新从函数目录部署云函数；新增 `getRoom` 自修复检查，发现 `room_views.sequence` 落后或当前用户 `room_inboxes/{roomId_openid}` 缺失/落后时刷新读模型并补齐 inbox；部署后用 `fn detail` 校验线上源码关键标记。
是否需要新增自动检查或测试：需要。短期必须在多人功能验收中增加“线上源码关键标记检查”和多账号审批/拒绝/移出同步测试；后续应补云函数部署后 smoke 脚本，自动检查线上 `CodeInfo` 包含关键同步逻辑。
```

### 2026-06-25 加入申请记录已写入但房主未收到待确认卡

```text
日期：2026-06-25
来源：human
场景：房间页 / 多账号同步 / 加入审批
结果：negative
分值：-9
严重度：5
置信度：5
影响模块：miniprogram / scoreFunctions / docs
关联代码位置：
- `miniprogram/pages/room/index.js`：`startRoomWatchers`、`applyRoomViewData`、`applyRoomInvalidationSnapshot`
- `cloudfunctions/scoreFunctions/index.js`：`refreshRoomView`
- `docs/architecture.md`：房间同步监听说明
问题对应关系：
- 申请加入后最近记录已有“申请加入”，但房主成员区没有待确认卡：后端已生成 pending 成员和记录，房主客户端没有稳定收到被动失效通知。
- `room_inboxes` 作为 private 集合可能受客户端可读权限影响；`room_views` 的 `_id + watchableOpenids` 数组条件 watch 也可能漏触发。
- `room_events` 已由云函数写入但此前没有被客户端正式监听，导致低成本兜底通知没有发挥作用。
现象：多账号调试中，申请方显示等待确认，房主端仍显示旧成员列表，需要刷新后才可能看到待确认 UI。
根因或推测：云函数日志显示 20:05 的 `joinRoom` 返回 `roomView.members` 已包含 `测试号03 status: pending`，所以问题不是写入失败，而是房主端 watcher 链路不完整。
处理方式：客户端新增 `room_events/{roomId}` watcher，收到更高 `sequence` 时才静默调用一次 `getRoom`；同时 `applyRoomViewData` 根据当前 openid 重新计算当前成员和房主身份，避免 watcher/inbox/getRoom 三条路径状态不一致。
是否需要新增自动检查或测试：需要补多账号自动化或人工矩阵，覆盖申请、同意、拒绝、移出时房主端和成员端的实时同步。
```
