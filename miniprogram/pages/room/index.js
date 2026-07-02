const { callScoreFunction, saveRecentRoom, showError } = require("../../utils/api");
const { buildAvatarView } = require("../../utils/avatar");
const {
  formatRecord: formatRecordForView,
  sortRecordsForView,
} = require("../../utils/records");
const {
  buildRoomShareMessage,
  buildRoomTimelineShare,
  enablePageShare,
} = require("../../utils/share");

// 操作类型到页面展示文案的映射。
const TYPE_LABELS = {
  // 单个成员加分。
  member_add: "成员加分",
  // 单个成员扣分。
  member_subtract: "成员扣分",
  // 多个成员批量加分。
  batch_add: "批量加分",
  // 多个成员批量扣分。
  batch_subtract: "批量扣分",
  // 公共积分转给成员。
  public_to_member: "公共积分转出",
  // 成员积分转回公共积分。
  member_to_public: "转回公共积分",
  // 成员之间转移积分。
  member_to_member: "成员间转移",
  // 同一来源批量转移给多个目标。
  batch_transfer: "批量转移",
  // 撤销一次积分变更。
  undo: "撤销操作",
  // 创建房间。
  room_created: "创建房间",
  // 成员加入房间。
  member_joined: "加入房间",
  // 成员申请加入。
  member_join_requested: "申请加入",
  // 成员加入申请被拒绝。
  member_join_rejected: "暂不加入",
  // 房主移出成员。
  member_removed: "成员移出",
  // 关闭房间。
  room_closed: "关闭房间",
};

const POSITIVE_RECORD_TYPES = ["member_add", "batch_add"];
const NEGATIVE_RECORD_TYPES = ["member_subtract", "batch_subtract"];
const TRANSFER_RECORD_TYPES = [
  "public_to_member",
  "member_to_public",
  "member_to_member",
  "batch_transfer",
];
const UNDOABLE_RECORD_TYPES = [
  "member_add",
  "member_subtract",
  "batch_add",
  "batch_subtract",
  "public_to_member",
  "member_to_public",
  "member_to_member",
  "batch_transfer",
];
const RECENT_RECORD_PAGE_SIZE = 5;

function writeRoomQrImage(roomCode, imageBase64) {
  const safeRoomCode = String(roomCode || "room").replace(/[^0-9A-Za-z_-]/g, "");
  const filePath = `${wx.env.USER_DATA_PATH}/room-entry-${safeRoomCode || "room"}.png`;
  wx.getFileSystemManager().writeFileSync(filePath, imageBase64, "base64");
  return filePath;
}

// 将记录时间格式化为房间页使用的短时间。
function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toTime(value) {
  if (!value) return 0;
  if (typeof value.getTime === "function") return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value.$date) return new Date(value.$date).getTime() || 0;
  return new Date(value).getTime() || 0;
}

function normalizeRoomForView(room) {
  if (!room) return room;
  if (room.status === "active" && room.expireAt && toTime(room.expireAt) <= Date.now()) {
    return {
      ...room,
      status: "expired",
    };
  }
  return room;
}

function isRoomOperable(room) {
  return !!(room && room.status === "active");
}

function getErrorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return [
    error.errMsg,
    error.message,
    error.code,
    error.errCode,
  ].filter(Boolean).join(" ");
}

function isRealtimeLoginStateError(error) {
  const text = getErrorText(error);
  return /realtime listener init watch fail|login fail|invalid state/i.test(text);
}

function getScoreTone(score) {
  if (score > 0) return "score-positive";
  if (score < 0) return "score-negative";
  return "score-neutral";
}

function getRecordTone(record) {
  if (POSITIVE_RECORD_TYPES.includes(record.type)) return "record-positive";
  if (NEGATIVE_RECORD_TYPES.includes(record.type)) return "record-negative";
  if (TRANSFER_RECORD_TYPES.includes(record.type)) return "record-transfer";
  if (record.type === "undo") return "record-undo";
  return "record-neutral";
}

function getAmountText(record) {
  if (!record.amount) return "";
  if (POSITIVE_RECORD_TYPES.includes(record.type)) return `+${record.amount}`;
  if (NEGATIVE_RECORD_TYPES.includes(record.type)) return `-${record.amount}`;
  if (TRANSFER_RECORD_TYPES.includes(record.type)) return `±${record.amount}`;
  return `${record.amount}`;
}

function getTargetLabel(target, currentMemberId) {
  if (target.type === "public") return "公共积分池";
  if (target.memberId && target.memberId === currentMemberId) return "我";
  return target.nickname || target.name || "成员";
}

function getTargetDelta(target) {
  const beforeScore = Number(target.beforeScore || 0);
  const afterScore = Number(target.afterScore || 0);
  return afterScore - beforeScore;
}

function formatChangedTargets(record, currentMemberId) {
  return (record.targets || [])
    .map((target) => getTargetLabel(target, currentMemberId))
    .join("、");
}

function formatFlowTargets(record, currentMemberId) {
  const targets = record.targets || [];
  const sources = targets
    .filter((target) => getTargetDelta(target) < 0)
    .map((target) => getTargetLabel(target, currentMemberId));
  const destinations = targets
    .filter((target) => getTargetDelta(target) > 0)
    .map((target) => getTargetLabel(target, currentMemberId));

  if (sources.length && destinations.length) {
    return `${sources.join("、")} → ${destinations.join("、")}`;
  }

  return targets.map((target) => getTargetLabel(target, currentMemberId)).join("、");
}

function getSnapshotMemberLabel(record, memberId, currentMemberId) {
  const target = findRecordMemberTarget(record, memberId);
  if (target) return getTargetLabel(target, currentMemberId);
  if (memberId === currentMemberId) return "我";
  return "成员";
}

function findRecordMemberTarget(record, memberId) {
  return (record.targets || []).find(
    (target) => target.type === "member" && target.memberId === memberId
  );
}

function formatSnapshotFlow(record, currentMemberId) {
  const beforeSnapshot = record.beforeSnapshot || {};
  const afterSnapshot = record.afterSnapshot || {};
  const flows = [];

  if (beforeSnapshot.room && afterSnapshot.room) {
    flows.push({
      label: "公共积分池",
      delta:
        Number(afterSnapshot.room.publicScore || 0) -
        Number(beforeSnapshot.room.publicScore || 0),
    });
  }

  const beforeMemberMap = (beforeSnapshot.members || []).reduce((map, member) => {
    map[member.memberId] = Number(member.score || 0);
    return map;
  }, {});
  const afterMemberMap = (afterSnapshot.members || []).reduce((map, member) => {
    map[member.memberId] = Number(member.score || 0);
    return map;
  }, {});
  const memberIds = [
    ...new Set([...Object.keys(beforeMemberMap), ...Object.keys(afterMemberMap)]),
  ];

  memberIds.forEach((memberId) => {
    flows.push({
      label: getSnapshotMemberLabel(record, memberId, currentMemberId),
      delta: Number(afterMemberMap[memberId] || 0) - Number(beforeMemberMap[memberId] || 0),
    });
  });

  const sources = flows.filter((flow) => flow.delta < 0).map((flow) => flow.label);
  const destinations = flows.filter((flow) => flow.delta > 0).map((flow) => flow.label);
  if (sources.length && destinations.length) {
    return `${sources.join("、")} → ${destinations.join("、")}`;
  }
  return "";
}

function getRecordTargetsText(record, currentMemberId) {
  if (POSITIVE_RECORD_TYPES.includes(record.type) || NEGATIVE_RECORD_TYPES.includes(record.type)) {
    return formatChangedTargets(record, currentMemberId);
  }

  if (TRANSFER_RECORD_TYPES.includes(record.type)) {
    return formatFlowTargets(record, currentMemberId);
  }

  if (record.type === "undo") {
    const flowText =
      formatSnapshotFlow(record, currentMemberId) || formatFlowTargets(record, currentMemberId);
    return flowText ? `撤销：${flowText}` : "撤销操作";
  }

  const targets = (record.targets || [])
    .map((target) => getTargetLabel(target, currentMemberId))
    .join("、");
  return targets || "房间";
}

// 将原始操作记录转换为页面展示结构。
function formatLocalRecord(record, currentMemberId) {
  return {
    ...record,
    displayType: TYPE_LABELS[record.type] || record.type,
    displayOperator: record.operatorNickname || "成员",
    displayTargets: getRecordTargetsText(record, currentMemberId),
    displayTime: formatTime(record.createdAt),
    amountText: getAmountText(record),
    toneClass: getRecordTone(record),
    canUndo: UNDOABLE_RECORD_TYPES.includes(record.type) && !record.isUndone,
  };
}

function buildRecentRecordPageState(records, page) {
  const allRecords = records || [];
  const totalPages = Math.max(1, Math.ceil(allRecords.length / RECENT_RECORD_PAGE_SIZE));
  const currentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (currentPage - 1) * RECENT_RECORD_PAGE_SIZE;

  return {
    allRecentRecords: allRecords,
    recentRecords: allRecords.slice(start, start + RECENT_RECORD_PAGE_SIZE),
    recentRecordPage: currentPage,
    recentRecordTotalPages: totalPages,
    recentRecordPageText: `${currentPage}/${totalPages}`,
    showRecentRecordPager: allRecords.length > RECENT_RECORD_PAGE_SIZE,
    canPrevRecentRecordPage: currentPage > 1,
    canNextRecentRecordPage: currentPage < totalPages,
  };
}

function getMemberRoleLabel(member) {
  return member.role === "owner" ? "房主" : "成员";
}

function normalizeMemberForView(member, currentMemberId, room) {
  const memberId = member._id || member.memberId || member.openid;
  const status = member.status || "active";
  const isActive = status === "active";
  const isPending = status === "pending";
  const isRemoved = status === "removed";
  const isCurrent = memberId === currentMemberId;
  return {
    ...member,
    _id: memberId,
    memberId,
    status,
    isActive,
    isPending,
    isRemoved,
    isCurrent,
    roleLabel: getMemberRoleLabel(member),
    ...buildAvatarView({
      nickname: member.nickname,
      seed: member.openid || member._id || member.nickname,
      muted: isRemoved,
    }),
    scoreTone: getScoreTone(member.score || 0),
    canRename:
      isCurrent &&
      isActive &&
      !member.nicknameEdited &&
      room &&
      room.status === "active",
  };
}

function sortMembersForView(members) {
  return [...members].sort((a, b) => {
    return new Date(a.joinedAt || 0).getTime() - new Date(b.joinedAt || 0).getTime();
  });
}

function buildMemberState(rawMembers, currentMemberId, room) {
  const normalizedMembers = sortMembersForView(
    (rawMembers || []).map((member) =>
      normalizeMemberForView(member, currentMemberId, room)
    )
  );
  const pendingMembers = normalizedMembers.filter((member) => member.isPending);
  const members = normalizedMembers
    .filter((member) => member.isActive || member.isRemoved)
    .map((member, index) => {
      const joinOrder = index + 1;
      const statusText = member.isRemoved
        ? "已移出 · 历史记录保留"
        : `第 ${joinOrder} 位加入 · ${member.roleLabel}`;
      return {
        ...member,
        joinOrder,
        statusText,
        canSelect: member.isActive,
      };
    });
  return {
    members,
    pendingMembers,
    activeMemberCount: members.filter((member) => member.isActive).length,
  };
}

function getRecordPublicScore(record) {
  const roomSnapshot = record && record.afterSnapshot && record.afterSnapshot.room;
  if (!roomSnapshot || roomSnapshot.publicScore === undefined) return null;
  const publicScore = Number(roomSnapshot.publicScore);
  return Number.isFinite(publicScore) ? publicScore : null;
}

function getLatestPublicScoreFromRecords(records) {
  for (let index = 0; index < records.length; index += 1) {
    const publicScore = getRecordPublicScore(records[index]);
    if (publicScore !== null) return publicScore;
  }
  return null;
}

function buildTransferTargetSummary(targets) {
  if (!targets.length) return "未选择目标";
  return targets.map((target) => target.label).join("、");
}

Page({
  data: {
    // 当前房间 ID，来自页面参数。
    roomId: "",
    // 分享路径携带的房间码，用于未加入用户转入加入流程。
    sharedRoomCode: "",
    // 页面加载状态。
    loading: true,
    // 房间云端数据不可用时的提示状态，本地最近房间缓存不在这里清理。
    loadFailed: false,
    loadErrorText: "",
    // 操作提交状态，防止重复点击。
    submitting: false,
    // 房间详情数据。
    room: null,
    // 房间数据库监听状态。
    syncStatusText: "",
    syncStatusClass: "",
    showSyncStatus: false,
    // 当前活跃成员列表。
    members: [],
    // 等待房主确认的加入申请。
    pendingMembers: [],
    // 当前 active 成员数量，已移出成员不占名额。
    activeMemberCount: 0,
    // 最近操作记录完整列表，用于房间页分页。
    allRecentRecords: [],
    // 最近操作记录展示列表。
    recentRecords: [],
    // 最近操作记录当前页码。
    recentRecordPage: 1,
    // 最近操作记录总页数。
    recentRecordTotalPages: 1,
    // 最近操作记录页码展示文本。
    recentRecordPageText: "1/1",
    // 最近操作记录是否显示分页控件。
    showRecentRecordPager: false,
    // 最近操作记录是否可翻到上一页。
    canPrevRecentRecordPage: false,
    // 最近操作记录是否可翻到下一页。
    canNextRecentRecordPage: false,
    // 当前用户是否为房主。
    isOwner: false,
    // 当前房间是否仍可进行写操作。
    isRoomOperable: false,
    // 当前用户是否可发起积分转移。
    canTransfer: false,
    // 当前用户在房间内的成员 ID。
    currentMemberId: "",
    // 当前用户在房间内的成员状态。
    currentMemberStatus: "",
    // 当前用户 openid，用于房间读模型监听权限过滤。
    currentOpenid: "",
    // 是否处于批量记分选择模式。
    batchMode: false,
    // 批量记分已选成员 ID 列表。
    batchSelected: [],
    // 是否处于批量转移选择模式。
    transferMode: false,
    // 批量转移已选目标成员 ID 列表。
    transferSelected: [],
    // 用户输入的转移分值。
    transferAmount: "",
    // 转移弹窗是否展示。
    transferDialogVisible: false,
    // 当前弹窗内的转入目标列表。
    transferTargets: [],
    // 当前转移来源类型。
    transferSourceType: "member",
    // 当前转移来源成员 ID。
    transferSourceMemberId: "",
    // 当前转移来源展示文案。
    transferSourceLabel: "我",
    // 当前选中目标展示文本。
    transferTargetSummary: "未选择目标",
    // 当前选中目标数量。
    transferTargetCount: 0,
    // 房间二维码弹窗是否展示。
    roomQrVisible: false,
    // 指向加入页的小程序二维码图片。
    roomQrImage: "",
    roomQrLoading: false,
  },

  // 初始化房间 ID 并加载房间数据。
  onLoad(options) {
    enablePageShare();
    this.setData({
      roomId: options.roomId || "",
      sharedRoomCode: options.roomCode || "",
    });
    this.loadRoom();
  },

  // 下拉刷新房间详情。
  onPullDownRefresh() {
    this.loadRoom().finally(() => wx.stopPullDownRefresh());
  },

  onShow() {
    enablePageShare();
    if (this.data.room) {
      this.startRoomWatchers();
      this.scheduleSilentRoomReload(300, Number(this.data.room.sequence || 0));
    }
  },

  onHide() {
    this.stopRoomWatchers();
    this.clearScheduledRoomReload();
  },

  onUnload() {
    this.stopRoomWatchers();
    this.clearScheduledRoomReload();
  },

  updateSyncStatus(status) {
    const statusMap = {
      connecting: { text: "同步中", className: "sync-pending" },
      connected: { text: "已同步", className: "sync-ok" },
      error: { text: "同步失败，请检查权限", className: "sync-error" },
      closed: { text: "", className: "" },
    };
    const next = statusMap[status] || statusMap.error;
    this.setData({
      syncStatusText: next.text,
      syncStatusClass: next.className,
      showSyncStatus: !!next.text,
    });
  },

  startRoomWatchers() {
    if (
      this.roomWatchers ||
      this.roomWatchUnavailable ||
      !this.data.roomId ||
      !this.data.currentOpenid
    ) return;
    const db = wx.cloud.database();
    const roomId = this.data.roomId;
    const onError = (source) => (error) => {
      console.warn(`[room-sync] ${source} watch unavailable`, error);
      this.stopRoomWatchers({ keepStatus: true, keepRecovery: true });
      if (isRealtimeLoginStateError(error)) {
        this.roomWatchUnavailable = true;
        this.updateSyncStatus("connected");
        return;
      }
      this.scheduleRoomViewRecovery();
    };

    this.updateSyncStatus("connecting");
    const watchers = [];
    try {
      watchers.push(
        db
          .collection("rooms")
          .where({
            _id: roomId,
          })
          .watch({
            onChange: (snapshot) => this.applyRoomSnapshot(snapshot),
            onError: onError("rooms"),
          })
      );
      this.roomWatchers = watchers;
    } catch (error) {
      watchers.forEach((watcher) => {
        if (watcher && typeof watcher.close === "function") watcher.close();
      });
      onError("setup")(error);
    }
  },

  stopRoomWatchers(options = {}) {
    if (!this.roomWatchers) return;
    this.roomWatchers.forEach((watcher) => {
      if (watcher && typeof watcher.close === "function") watcher.close();
    });
    this.roomWatchers = null;
    if (!options.keepRecovery && this.roomViewRecoveryTimer) {
      clearTimeout(this.roomViewRecoveryTimer);
      this.roomViewRecoveryTimer = null;
    }
    if (!options.keepStatus) this.updateSyncStatus("closed");
  },

  clearScheduledRoomReload() {
    if (this.roomReloadTimer) {
      clearTimeout(this.roomReloadTimer);
      this.roomReloadTimer = null;
    }
    this.pendingRoomReloadSequence = 0;
  },

  scheduleSilentRoomReload(delay = 300, minSequence = 0) {
    const nextSequence = Number(minSequence || 0);
    this.pendingRoomReloadSequence = Math.max(
      Number(this.pendingRoomReloadSequence || 0),
      nextSequence
    );
    if (this.roomReloadTimer) clearTimeout(this.roomReloadTimer);
    this.roomReloadTimer = setTimeout(() => {
      this.roomReloadTimer = null;
      if (!this.data.roomId || !this.data.room) return;
      const targetSequence = Number(this.pendingRoomReloadSequence || 0);
      const currentSequence = Number((this.data.room && this.data.room.sequence) || 0);
      this.pendingRoomReloadSequence = 0;
      if (targetSequence && currentSequence >= targetSequence) return;
      this.loadRoom({ silent: true });
    }, delay);
  },

  applyRoomSnapshot(snapshot) {
    const room = (snapshot.docs || [])[0];
    if (!room || room._id !== this.data.roomId) {
      this.scheduleRoomViewRecovery();
      return;
    }
    this.applyRoomViewData({
      room,
      members: room.members || [],
      pendingMembers: (room.members || []).filter((member) => member.status === "pending"),
      recentRecords: room.records || [],
    });
  },

  applyRoomViewData(view) {
    if (!view || !view.room) return;
    if (this.roomViewRecoveryTimer) {
      clearTimeout(this.roomViewRecoveryTimer);
      this.roomViewRecoveryTimer = null;
    }
    const room = normalizeRoomForView(view.room);
    const roomOperable = isRoomOperable(room);
    const currentOpenid = this.data.currentOpenid || "";
    const rawMembers = view.members || view.room.members || [];
    const currentMember =
      rawMembers.find((member) => currentOpenid && member.openid === currentOpenid) ||
      rawMembers.find(
        (member) =>
          (member._id || member.memberId || member.openid) === this.data.currentMemberId
      ) ||
      null;
    const currentMemberId =
      (currentMember && (currentMember._id || currentMember.memberId || currentMember.openid)) ||
      this.data.currentMemberId;
    const isOwner =
      !!(
        (currentOpenid && view.room.ownerOpenid === currentOpenid) ||
        (currentMember && currentMember.role === "owner") ||
        this.data.isOwner
      );
    const memberState = buildMemberState(
      rawMembers,
      currentMemberId,
      room
    );
    const sortedRecords = sortRecordsForView(view.recentRecords || view.room.records || []);
    const formattedRecords = sortedRecords.map((record) =>
      formatRecordForView(record, currentMemberId)
    );
    const nextData = {
      room,
      ...memberState,
      ...buildRecentRecordPageState(formattedRecords, this.data.recentRecordPage),
      isOwner,
      isRoomOperable: roomOperable,
      currentMemberId,
      currentMemberStatus: (currentMember && currentMember.status) || this.data.currentMemberStatus,
      canTransfer: !!(
        roomOperable &&
        currentMemberId &&
        currentMember &&
        currentMember.status === "active"
      ),
    };
    if (!roomOperable) {
      Object.assign(nextData, {
        batchMode: false,
        batchSelected: [],
        transferMode: false,
        transferSelected: [],
        transferDialogVisible: false,
        transferTargets: [],
      });
    }
    this.setData(nextData);
    this.updateSyncStatus("connected");
  },

  applyRoomViewSnapshot(snapshot) {
    this.applyRoomSnapshot(snapshot);
  },

  applyWriteResult(result) {
    if (result && result.roomView) this.applyRoomViewData(result.roomView);
  },

  applyRoomInboxSnapshot(snapshot) {
    this.applyRoomInvalidationSnapshot(snapshot, "rooms");
  },

  applyRoomInvalidationSnapshot(snapshot, source) {
    const event = (snapshot.docs || [])[0];
    if (!event || event.roomId !== this.data.roomId) return;
    const remoteSequence = Number(event.sequence || 0);
    const localSequence = Number((this.data.room && this.data.room.sequence) || 0);
    if (remoteSequence > localSequence) {
      this.scheduleSilentRoomReload(600, remoteSequence);
      return;
    }
    this.updateSyncStatus("connected");
  },

  scheduleRoomViewRecovery() {
    if (this.roomViewRecoveryTimer) return;
    this.updateSyncStatus("connecting");
    this.roomViewRecoveryTimer = setTimeout(() => {
      this.roomViewRecoveryTimer = null;
      if (!this.data.roomId || !this.data.room) return;
      this.loadRoom({ silent: true });
    }, 1000);
  },

  applyMembersSnapshot(snapshot) {
    const docs = snapshot.docs || [];
    if (!docs.length && this.data.currentMemberId) {
      this.updateSyncStatus("error");
      return;
    }
    const currentMember = docs.find((member) => member._id === this.data.currentMemberId);
    this.setData({
      ...buildMemberState(docs, this.data.currentMemberId, this.data.room),
      currentMemberStatus: (currentMember && currentMember.status) || this.data.currentMemberStatus,
      canTransfer: !!(
        this.data.currentMemberId &&
        currentMember &&
        currentMember.status === "active"
      ),
    });
    this.updateSyncStatus("connected");
  },

  applyRecordsSnapshot(snapshot) {
    const docs = snapshot.docs || [];
    if (!docs.length && this.data.allRecentRecords.length) {
      this.updateSyncStatus("error");
      return;
    }
    const sortedRecords = sortRecordsForView(docs);
    const formattedRecords = sortedRecords.map((record) =>
      formatRecordForView(record, this.data.currentMemberId)
    );
    const nextData = buildRecentRecordPageState(
      formattedRecords,
      this.data.recentRecordPage
    );
    const latestPublicScore = getLatestPublicScoreFromRecords(sortedRecords);
    if (latestPublicScore !== null && this.data.room) {
      nextData.room = {
        ...this.data.room,
        publicScore: latestPublicScore,
      };
    }
    this.setData(nextData);
    this.updateSyncStatus("connected");
  },

  // 从云函数加载房间、成员、记录和当前用户权限。
  loadRoom(options = {}) {
    if (!this.data.roomId) {
      if (!options.silent) {
        this.setData({
          loading: false,
          loadFailed: true,
          room: null,
          loadErrorText: "缺少房间 ID，请从首页、房间码或分享链接进入。",
        });
      }
      return Promise.resolve();
    }
    if (options.silent && this.silentRoomLoading) return Promise.resolve();
    if (options.silent) this.silentRoomLoading = true;
    if (!options.silent) this.setData({ loading: true });
    return callScoreFunction("getRoom", { roomId: this.data.roomId })
      .then((result) => {
        const isOwner = result.currentUserRole === "owner";
        const currentMember = result.currentMember || null;
        const currentMemberId = (currentMember && currentMember._id) || "";
        const currentOpenid = (currentMember && currentMember.openid) || "";
        const room = normalizeRoomForView(result.room);
        const roomOperable = isRoomOperable(room);
        const memberState = buildMemberState(result.members || [], currentMemberId, room);
        const formattedRecords = sortRecordsForView(result.recentRecords || []).map((record) =>
          formatRecordForView(record, currentMemberId)
        );
        const nextData = {
          room,
          ...memberState,
          ...buildRecentRecordPageState(formattedRecords, 1),
          isOwner,
          isRoomOperable: roomOperable,
          canTransfer: !!(
            roomOperable &&
            currentMemberId &&
            currentMember &&
            currentMember.status === "active"
          ),
          currentMemberId,
          currentOpenid,
          currentMemberStatus: (currentMember && currentMember.status) || "",
          loading: false,
          loadFailed: false,
          loadErrorText: "",
        };
        if (!options.silent) {
          Object.assign(nextData, {
            transferDialogVisible: false,
            transferMode: false,
            transferSelected: [],
            transferTargets: [],
            transferSourceType: "member",
            transferSourceMemberId: currentMemberId,
            transferSourceLabel: "我",
            transferTargetSummary: "未选择目标",
            transferTargetCount: 0,
          });
        }
        if (!roomOperable) {
          Object.assign(nextData, {
            transferDialogVisible: false,
            transferMode: false,
            transferSelected: [],
            transferTargets: [],
            batchMode: false,
            batchSelected: [],
          });
        }
        this.setData(nextData);
        this.startRoomWatchers();
        this.updateSyncStatus("connected");
        saveRecentRoom({
          roomId: result.room._id,
          roomCode: result.room.roomCode,
          name: result.room.name,
        });
      })
      .catch((error) => {
        const isRoomMissing = error.code === "ROOM_NOT_FOUND";
        const isAccessDenied = error.code === "ROOM_ACCESS_DENIED";
        if (isAccessDenied && this.data.sharedRoomCode) {
          wx.redirectTo({
            url: `/pages/join-room/index?roomId=${this.data.roomId}&roomCode=${this.data.sharedRoomCode}`,
          });
          return;
        }
        const shouldLeaveRoomView = isRoomMissing || isAccessDenied;
        this.setData({
          loading: false,
          loadFailed: true,
          room: shouldLeaveRoomView ? null : this.data.room,
          loadErrorText: isRoomMissing
            ? "云端房间可能已过期并被清理，本地历史入口会保留。"
            : isAccessDenied
              ? "你当前不在该房间内，可能需要重新提交加入申请。"
              : error.message || "房间加载失败",
        });
        if (!isRoomMissing && !isAccessDenied) {
          if (!options.silent) showError(error);
        }
      })
      .finally(() => {
        if (options.silent) this.silentRoomLoading = false;
      });
  },

  goHome() {
    wx.redirectTo({
      url: "/pages/index/index",
    });
  },

  // 切换房间页最近记录分页。
  changeRecentRecordPage(event) {
    const direction = event.currentTarget.dataset.direction;
    const offset = direction === "next" ? 1 : -1;
    this.setData(
      buildRecentRecordPageState(this.data.allRecentRecords, this.data.recentRecordPage + offset)
    );
  },

  // 复制房间码，方便用户分享给其他成员。
  copyRoomCode() {
    wx.setClipboardData({
      data: (this.data.room && this.data.room.roomCode) || "",
    });
  },

  // 展示房间小程序二维码，供其他成员用微信或首页“扫码加入”扫描。
  showRoomQrCode() {
    const roomCode = (this.data.room && this.data.room.roomCode) || "";
    if (!roomCode) {
      wx.showToast({ title: "缺少房间码", icon: "none" });
      return;
    }
    if (this.data.roomQrImage) {
      this.setData({
        roomQrVisible: true,
      });
      return;
    }
    this.setData({
      roomQrVisible: true,
      roomQrLoading: true,
    });
    callScoreFunction("getRoomEntryCode", {
      roomId: this.data.roomId,
    })
      .then((result) => {
        const imagePath = writeRoomQrImage(roomCode, result.imageBase64);
        this.setData({
          roomQrImage: imagePath,
          roomQrLoading: false,
        });
      })
      .catch((error) => {
        this.setData({ roomQrLoading: false });
        showError(error);
      });
  },

  // 关闭房间码二维码弹窗。
  closeRoomQrCode() {
    this.setData({
      roomQrVisible: false,
    });
  },

  showBusyLoading(title) {
    this.busyLoadingVisible = true;
    wx.showLoading({ title });
  },

  hideBusyLoading() {
    if (!this.busyLoadingVisible) return;
    wx.hideLoading();
    this.busyLoadingVisible = false;
  },

  showBusySuccess(title) {
    this.hideBusyLoading();
    wx.showToast({ title, icon: "success" });
  },

  showBusyError(error) {
    this.hideBusyLoading();
    showError(error);
  },

  promptNickname(currentName) {
    return new Promise((resolve, reject) => {
      wx.showModal({
        title: "修改昵称",
        editable: true,
        placeholderText: "请输入 1 到 20 个字符",
        content: currentName || "",
        confirmText: "保存",
        success: (res) => {
          if (!res.confirm) {
            reject(new Error("已取消"));
            return;
          }
          const nickname = String(res.content || "").trim();
          if (!nickname) {
            reject(new Error("昵称不能为空"));
            return;
          }
          if (nickname.length > 20) {
            reject(new Error("昵称最多 20 个字符"));
            return;
          }
          resolve(nickname);
        },
        fail: reject,
      });
    });
  },

  updateNickname(event) {
    if (this.data.submitting) return;
    const { nickname } = event.currentTarget.dataset;
    this.promptNickname(nickname)
      .then((nextNickname) => {
        this.setData({ submitting: true });
        this.showBusyLoading("保存中");
        return callScoreFunction("updateNickname", {
          roomId: this.data.roomId,
          nickname: nextNickname,
        });
      })
      .then((result) => {
        this.applyWriteResult(result);
        this.showBusySuccess("已修改");
      })
      .catch((error) => {
        if (error.message !== "已取消") this.showBusyError(error);
      })
      .finally(() => {
        this.hideBusyLoading();
        this.setData({ submitting: false });
      });
  },

  // 弹出分值输入框，并校验 1 到 9999 的整数。
  promptAmount(title) {
    return new Promise((resolve, reject) => {
      wx.showModal({
        title,
        editable: true,
        placeholderText: "请输入 1 到 9999 的整数",
        confirmText: "确认",
        success: (res) => {
          if (!res.confirm) {
            reject(new Error("已取消"));
            return;
          }
          const amount = Number(res.content);
          if (!Number.isInteger(amount) || amount <= 0 || amount > 9999) {
            reject(new Error("分值必须是 1 到 9999 的整数"));
            return;
          }
          resolve(amount);
        },
        fail: reject,
      });
    });
  },

  // 房主对单个成员执行加分或扣分。
  updateMemberScore(event) {
    if (this.data.submitting) return;
    const { memberId, action, nickname } = event.currentTarget.dataset;
    const title = action === "subtract" ? `给 ${nickname} 扣分` : `给 ${nickname} 加分`;
    this.promptAmount(title)
      .then((amount) => {
        this.setData({ submitting: true });
        this.showBusyLoading("提交中");
        return callScoreFunction("updateScore", {
          roomId: this.data.roomId,
          memberId,
          action,
          amount,
        });
      })
      .then((result) => {
        this.applyWriteResult(result);
        this.showBusySuccess("已更新");
      })
      .catch((error) => {
        if (error.message !== "已取消") this.showBusyError(error);
      })
      .finally(() => {
        this.hideBusyLoading();
        this.setData({ submitting: false });
      });
  },

  // 切换批量记分模式，并清空已选成员。
  toggleBatchMode() {
    const nextBatchMode = !this.data.batchMode;
    this.setData({
      batchMode: nextBatchMode,
      batchSelected: [],
      transferMode: false,
      transferSelected: [],
    });
  },

  // 切换批量转移模式，并清空已选成员。
  toggleTransferMode() {
    const nextTransferMode = !this.data.transferMode;
    this.setData({
      transferMode: nextTransferMode,
      transferSelected: [],
      batchMode: false,
      batchSelected: [],
    });
  },

  // 更新成员选择列表，按当前模式分别用于批量记分或批量转移。
  onMemberSelectChange(event) {
    const values = event.detail.value;
    const activeMemberIds = this.data.members
      .filter((member) => member.isActive)
      .map((member) => member._id);
    if (this.data.transferMode) {
      this.setData({
        transferSelected: values.filter(
          (memberId) =>
            memberId !== this.data.currentMemberId && activeMemberIds.includes(memberId)
        ),
      });
      return;
    }
    this.setData({
      batchSelected: values.filter((memberId) => activeMemberIds.includes(memberId)),
    });
  },

  // 提交批量加分或扣分请求。
  runBatch(event) {
    if (this.data.submitting) return;
    const { action } = event.currentTarget.dataset;
    if (!this.data.batchSelected.length) {
      wx.showToast({ title: "请选择成员", icon: "none" });
      return;
    }
    const title = action === "subtract" ? "批量扣分" : "批量加分";
    this.promptAmount(title)
      .then((amount) => {
        this.setData({ submitting: true });
        this.showBusyLoading("提交中");
        return callScoreFunction("batchUpdateScore", {
          roomId: this.data.roomId,
          memberIds: this.data.batchSelected,
          action,
          amount,
        });
      })
      .then((result) => {
        this.applyWriteResult(result);
        this.showBusySuccess("已更新");
        this.setData({ batchSelected: [], batchMode: false });
      })
      .catch((error) => {
        if (error.message !== "已取消") this.showBusyError(error);
      })
      .finally(() => {
        this.hideBusyLoading();
        this.setData({ submitting: false });
      });
  },

  // 更新积分转移分值输入。
  onTransferAmountInput(event) {
    this.setData({
      transferAmount: event.detail.value,
    });
  },

  // 阻止弹窗内部点击冒泡到遮罩。
  noop() {},

  // 打开转移确认弹窗。
  openTransferDialogWithTargets(targets, source = {}) {
    if (!this.data.currentMemberId) {
      wx.showToast({ title: "请先加入房间", icon: "none" });
      return;
    }
    if (!targets.length) {
      wx.showToast({ title: "请选择转入目标", icon: "none" });
      return;
    }
    this.setData({
      transferDialogVisible: true,
      transferTargets: targets,
      transferSourceType: source.type || "member",
      transferSourceMemberId: source.memberId || this.data.currentMemberId,
      transferSourceLabel: source.label || "我",
      transferTargetSummary: buildTransferTargetSummary(targets),
      transferTargetCount: targets.length,
    });
  },

  // 从自己转给单个成员。
  openMemberTransferDialog(event) {
    const { memberId, nickname } = event.currentTarget.dataset;
    if (!memberId || memberId === this.data.currentMemberId) {
      wx.showToast({ title: "不能转给自己", icon: "none" });
      return;
    }
    this.openTransferDialogWithTargets([
      {
        type: "member",
        memberId,
        label: nickname || "成员",
      },
    ]);
  },

  // 从自己转入公共积分池。
  openTransferToPublicDialog() {
    this.openTransferDialogWithTargets([
      {
        type: "public",
        memberId: "",
        label: "公共积分池",
      },
    ]);
  },

  // 从公共积分池转给自己。
  openTransferFromPublicDialog() {
    this.openTransferDialogWithTargets(
      [
        {
          type: "member",
          memberId: this.data.currentMemberId,
          label: "我",
        },
      ],
      {
        type: "public",
        memberId: "",
        label: "公共积分池",
      }
    );
  },

  // 从自己批量转给已选成员。
  openBatchTransferDialog() {
    const selectedSet = {};
    this.data.transferSelected.forEach((memberId) => {
      selectedSet[memberId] = true;
    });
    const targets = this.data.members
      .filter(
        (member) =>
          member.isActive && selectedSet[member._id] && member._id !== this.data.currentMemberId
      )
      .map((member) => ({
        type: "member",
        memberId: member._id,
        label: member.nickname,
      }));
    this.openTransferDialogWithTargets(targets);
  },

  // 关闭转移弹窗，清空输入。
  closeTransferDialog() {
    this.setData({
      transferDialogVisible: false,
      transferAmount: "",
      transferTargets: [],
      transferSourceType: "member",
      transferSourceMemberId: this.data.currentMemberId,
      transferSourceLabel: "我",
      transferTargetSummary: "未选择目标",
      transferTargetCount: 0,
    });
  },

  // 提交单目标或多目标积分转移请求，云函数负责最终权限和事务校验。
  submitTransfer() {
    if (this.data.submitting) return;
    const targets = this.data.transferTargets;
    const amount = Number(this.data.transferAmount);
    if (!this.data.currentMemberId || !targets.length) {
      wx.showToast({ title: "请选择转入目标", icon: "none" });
      return;
    }
    if (!Number.isInteger(amount) || amount <= 0 || amount > 9999) {
      wx.showToast({ title: "请输入有效分值", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    this.showBusyLoading("提交中");
    callScoreFunction("batchTransferScore", {
      roomId: this.data.roomId,
      fromType: this.data.transferSourceType,
      fromMemberId: this.data.transferSourceMemberId,
      targets: targets.map((target) => ({
        toType: target.type,
        toMemberId: target.memberId,
      })),
      amount,
    })
      .then((result) => {
        this.applyWriteResult(result);
        this.showBusySuccess("已转移");
        this.setData({
          transferDialogVisible: false,
          transferAmount: "",
          transferTargets: [],
          transferSourceType: "member",
          transferSourceMemberId: this.data.currentMemberId,
          transferSourceLabel: "我",
          transferTargetSummary: "未选择目标",
          transferTargetCount: 0,
          transferMode: false,
          transferSelected: [],
        });
      })
      .catch((error) => this.showBusyError(error))
      .finally(() => {
        this.hideBusyLoading();
        this.setData({ submitting: false });
      });
  },

  reviewJoinRequest(event) {
    if (this.data.submitting) return;
    const { memberId, action, nickname } = event.currentTarget.dataset;
    const approve = action === "approve";
    wx.showModal({
      title: approve ? "同意加入" : "暂不加入",
      content: approve
        ? `确认让 ${nickname || "该成员"} 加入房间？`
        : `确认暂不让 ${nickname || "该成员"} 加入房间？`,
      confirmText: approve ? "同意" : "确认",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ submitting: true });
        this.showBusyLoading("处理中");
        callScoreFunction("reviewJoinRequest", {
          roomId: this.data.roomId,
          memberId,
          action,
        })
          .then((result) => {
            this.applyWriteResult(result);
            this.showBusySuccess(approve ? "已同意" : "已处理");
          })
          .catch((error) => this.showBusyError(error))
          .finally(() => {
            this.hideBusyLoading();
            this.setData({ submitting: false });
          });
      },
    });
  },

  removeMember(event) {
    if (this.data.submitting) return;
    const { memberId, nickname } = event.currentTarget.dataset;
    wx.showModal({
      title: "移出成员",
      content: `确认将 ${nickname || "该成员"} 移出房间？成员记录会保留。`,
      confirmText: "移出",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ submitting: true });
        this.showBusyLoading("处理中");
        callScoreFunction("removeMember", {
          roomId: this.data.roomId,
          memberId,
        })
          .then((result) => {
            this.applyWriteResult(result);
            this.showBusySuccess("已移出");
          })
          .catch((error) => this.showBusyError(error))
          .finally(() => {
            this.hideBusyLoading();
            this.setData({ submitting: false });
          });
      },
    });
  },

  // 房主撤销指定的一条可撤销积分记录。
  undoRecord(event) {
    if (this.data.submitting) return;
    const { recordId, title } = event.currentTarget.dataset;
    if (!recordId) return;
    wx.showModal({
      title: "撤销该记录",
      content: `确认撤销「${title || "该积分变更"}」？撤销后会新增一条撤销记录。`,
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ submitting: true });
        this.showBusyLoading("撤销中");
        callScoreFunction("undoLastAction", {
          roomId: this.data.roomId,
          recordId,
        })
          .then((result) => {
            this.applyWriteResult(result);
            this.showBusySuccess("已撤销");
          })
          .catch((error) => this.showBusyError(error))
          .finally(() => {
            this.hideBusyLoading();
            this.setData({ submitting: false });
          });
      },
    });
  },

  // 房主关闭房间，关闭后仅保留查看能力。
  closeRoom() {
    wx.showModal({
      title: "关闭房间",
      content: "关闭后不能继续修改积分，但仍可查看结果。",
      confirmText: "关闭",
      success: (res) => {
        if (!res.confirm) return;
        this.showBusyLoading("关闭中");
        callScoreFunction("closeRoom", { roomId: this.data.roomId })
          .then((result) => {
            this.applyWriteResult(result);
            this.showBusySuccess("已关闭");
          })
          .catch((error) => this.showBusyError(error))
          .finally(() => this.hideBusyLoading());
      },
    });
  },

  // 跳转到完整操作记录页。
  goRecords() {
    wx.navigateTo({
      url: `/pages/records/index?roomId=${this.data.roomId}`,
    });
  },

  // 配置微信分享卡片，携带当前房间 ID。
  onShareAppMessage() {
    return buildRoomShareMessage({
      ...(this.data.room || {}),
      _id: (this.data.room && this.data.room._id) || this.data.roomId,
    });
  },

  onShareTimeline() {
    return buildRoomTimelineShare({
      ...(this.data.room || {}),
      _id: (this.data.room && this.data.room._id) || this.data.roomId,
    });
  },
});
