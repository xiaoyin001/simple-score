const { callScoreFunction, saveRecentRoom, showError } = require("../../utils/api");
const { buildQrRows } = require("../../utils/qrcode");

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

// 将记录时间格式化为房间页使用的短时间。
function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
function formatRecord(record, currentMemberId) {
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

function buildTransferTargetSummary(targets) {
  if (!targets.length) return "未选择目标";
  return targets.map((target) => target.label).join("、");
}

Page({
  data: {
    // 当前房间 ID，来自页面参数。
    roomId: "",
    // 页面加载状态。
    loading: true,
    // 房间云端数据不可用时的提示状态，本地最近房间缓存不在这里清理。
    loadFailed: false,
    loadErrorText: "",
    // 操作提交状态，防止重复点击。
    submitting: false,
    // 房间详情数据。
    room: null,
    // 当前活跃成员列表。
    members: [],
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
    // 当前用户是否可发起积分转移。
    canTransfer: false,
    // 当前用户在房间内的成员 ID。
    currentMemberId: "",
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
    // 房间码二维码矩阵。
    roomQrRows: [],
  },

  // 初始化房间 ID 并加载房间数据。
  onLoad(options) {
    this.setData({
      roomId: options.roomId || "",
    });
    this.loadRoom();
  },

  // 下拉刷新房间详情。
  onPullDownRefresh() {
    this.loadRoom().finally(() => wx.stopPullDownRefresh());
  },

  // 从云函数加载房间、成员、记录和当前用户权限。
  loadRoom() {
    if (!this.data.roomId) {
      wx.showToast({ title: "缺少房间 ID", icon: "none" });
      return Promise.resolve();
    }
    this.setData({ loading: true });
    return callScoreFunction("getRoom", { roomId: this.data.roomId })
      .then((result) => {
        const isOwner = result.currentUserRole === "owner";
        const currentMember = result.currentMember || null;
        const currentMemberId = (currentMember && currentMember._id) || "";
        const members = (result.members || []).map((member) => ({
          ...member,
          scoreTone: getScoreTone(member.score || 0),
          canRename:
            member._id === currentMemberId &&
            !member.nicknameEdited &&
            result.room &&
            result.room.status === "active",
        }));
        const formattedRecords = (result.recentRecords || []).map((record) =>
          formatRecord(record, currentMemberId)
        );
        this.setData({
          room: result.room,
          members,
          ...buildRecentRecordPageState(formattedRecords, 1),
          isOwner,
          canTransfer: !!currentMemberId,
          currentMemberId,
          transferDialogVisible: false,
          transferMode: false,
          transferSelected: [],
          transferTargets: [],
          transferSourceType: "member",
          transferSourceMemberId: currentMemberId,
          transferSourceLabel: "我",
          transferTargetSummary: "未选择目标",
          transferTargetCount: 0,
          loading: false,
          loadFailed: false,
          loadErrorText: "",
        });
        saveRecentRoom({
          roomId: result.room._id,
          roomCode: result.room.roomCode,
          name: result.room.name,
        });
      })
      .catch((error) => {
        const isRoomMissing = error.code === "ROOM_NOT_FOUND";
        this.setData({
          loading: false,
          loadFailed: true,
          loadErrorText: isRoomMissing
            ? "云端房间可能已过期并被清理，本地历史入口会保留。"
            : error.message || "房间加载失败",
        });
        if (!isRoomMissing) {
          showError(error);
        }
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

  // 展示房间码二维码，供其他成员用首页“扫码加入”扫描。
  showRoomQrCode() {
    const roomCode = (this.data.room && this.data.room.roomCode) || "";
    if (!roomCode) {
      wx.showToast({ title: "缺少房间码", icon: "none" });
      return;
    }
    try {
      this.setData({
        roomQrVisible: true,
        roomQrRows: buildQrRows(roomCode),
      });
    } catch (error) {
      showError(error);
    }
  },

  // 关闭房间码二维码弹窗。
  closeRoomQrCode() {
    this.setData({
      roomQrVisible: false,
    });
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
        wx.showLoading({ title: "保存中" });
        return callScoreFunction("updateNickname", {
          roomId: this.data.roomId,
          nickname: nextNickname,
        });
      })
      .then(() => {
        wx.showToast({ title: "已修改", icon: "success" });
        return this.loadRoom();
      })
      .catch((error) => {
        if (error.message !== "已取消") showError(error);
      })
      .finally(() => {
        wx.hideLoading();
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
        wx.showLoading({ title: "提交中" });
        return callScoreFunction("updateScore", {
          roomId: this.data.roomId,
          memberId,
          action,
          amount,
        });
      })
      .then(() => {
        wx.showToast({ title: "已更新", icon: "success" });
        return this.loadRoom();
      })
      .catch((error) => {
        if (error.message !== "已取消") showError(error);
      })
      .finally(() => {
        wx.hideLoading();
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
    if (this.data.transferMode) {
      this.setData({
        transferSelected: values.filter((memberId) => memberId !== this.data.currentMemberId),
      });
      return;
    }
    this.setData({
      batchSelected: values,
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
        wx.showLoading({ title: "提交中" });
        return callScoreFunction("batchUpdateScore", {
          roomId: this.data.roomId,
          memberIds: this.data.batchSelected,
          action,
          amount,
        });
      })
      .then(() => {
        wx.showToast({ title: "已更新", icon: "success" });
        this.setData({ batchSelected: [], batchMode: false });
        return this.loadRoom();
      })
      .catch((error) => {
        if (error.message !== "已取消") showError(error);
      })
      .finally(() => {
        wx.hideLoading();
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
      .filter((member) => selectedSet[member._id] && member._id !== this.data.currentMemberId)
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
    wx.showLoading({ title: "提交中" });
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
      .then(() => {
        wx.showToast({ title: "已转移", icon: "success" });
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
        return this.loadRoom();
      })
      .catch(showError)
      .finally(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
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
        wx.showLoading({ title: "撤销中" });
        callScoreFunction("undoLastAction", {
          roomId: this.data.roomId,
          recordId,
        })
          .then(() => {
            wx.showToast({ title: "已撤销", icon: "success" });
            return this.loadRoom();
          })
          .catch(showError)
          .finally(() => {
            wx.hideLoading();
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
        wx.showLoading({ title: "关闭中" });
        callScoreFunction("closeRoom", { roomId: this.data.roomId })
          .then(() => this.loadRoom())
          .catch(showError)
          .finally(() => wx.hideLoading());
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
    const room = this.data.room || {};
    return {
      title: `加入我的记分房间：${room.name || "简单记分鸭"}`,
      path: `/pages/index/index?roomId=${room._id || this.data.roomId}`,
    };
  },
});
