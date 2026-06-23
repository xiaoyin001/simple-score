const { callScoreFunction, saveRecentRoom, showError } = require("../../utils/api");

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
  // 撤销一次积分变更。
  undo: "撤销操作",
  // 创建房间。
  room_created: "创建房间",
  // 成员加入房间。
  member_joined: "加入房间",
  // 关闭房间。
  room_closed: "关闭房间",
};

// 将记录时间格式化为房间页使用的短时间。
function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 将原始操作记录转换为页面展示结构。
function formatRecord(record) {
  const targets = (record.targets || [])
    .map((target) => target.nickname || target.name || (target.type === "public" ? "公共积分池" : "成员"))
    .join("、");
  return {
    ...record,
    displayType: TYPE_LABELS[record.type] || record.type,
    displayTargets: targets || "房间",
    displayTime: formatTime(record.createdAt),
    amountText: record.amount ? `${record.amount}` : "",
  };
}

Page({
  data: {
    // 当前房间 ID，来自页面参数。
    roomId: "",
    // 页面加载状态。
    loading: true,
    // 操作提交状态，防止重复点击。
    submitting: false,
    // 房间详情数据。
    room: null,
    // 当前活跃成员列表。
    members: [],
    // 最近操作记录展示列表。
    recentRecords: [],
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
    // 积分转出对象选项。
    transferFromOptions: [],
    // 积分转入对象选项。
    transferToOptions: [],
    // 当前选中的转出对象索引。
    transferFromIndex: 0,
    // 当前选中的转入对象索引。
    transferToIndex: 1,
    // 用户输入的转移分值。
    transferAmount: "",
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
        const members = result.members || [];
        const isOwner = result.currentUserRole === "owner";
        const currentMember = result.currentMember || null;
        const currentMemberId = (currentMember && currentMember._id) || "";
        const transferState = this.buildTransferOptions(members, isOwner, currentMemberId, 0);
        this.setData({
          room: result.room,
          members,
          recentRecords: (result.recentRecords || []).map(formatRecord),
          isOwner,
          canTransfer: isOwner || !!currentMemberId,
          currentMemberId,
          transferFromOptions: transferState.fromOptions,
          transferToOptions: transferState.toOptions,
          transferFromIndex: transferState.fromIndex,
          transferToIndex: transferState.toIndex,
          loading: false,
        });
        saveRecentRoom({
          roomId: result.room._id,
          roomCode: result.room.roomCode,
          name: result.room.name,
        });
      })
      .catch((error) => {
        this.setData({ loading: false });
        showError(error);
      });
  },

  // 构建积分转移的转出和转入选项，普通成员只开放受限选项。
  buildTransferOptions(members, isOwner, currentMemberId, preferredFromIndex) {
    const memberOptions = members.map((member) => ({
      label: member.nickname,
      type: "member",
      memberId: member._id,
    }));
    const publicOption = { label: "公共积分池", type: "public", memberId: "" };

    if (isOwner) {
      const fromOptions = [publicOption, ...memberOptions];
      const fromIndex = Math.min(preferredFromIndex || 0, fromOptions.length - 1);
      return {
        fromOptions,
        toOptions: fromOptions,
        fromIndex,
        toIndex: fromIndex === 0 && fromOptions.length > 1 ? 1 : 0,
      };
    }

    const selfOption = memberOptions.find((option) => option.memberId === currentMemberId);
    if (!selfOption) {
      return {
        fromOptions: [],
        toOptions: [],
        fromIndex: 0,
        toIndex: 0,
      };
    }

    const fromOptions = [selfOption, publicOption];
    const fromIndex = Math.min(preferredFromIndex || 0, fromOptions.length - 1);
    const selectedFrom = fromOptions[fromIndex];
    const toOptions =
      selectedFrom.type === "public"
        ? [selfOption]
        : [
            publicOption,
            ...memberOptions.filter((option) => option.memberId !== currentMemberId),
          ];

    return {
      fromOptions,
      toOptions,
      fromIndex,
      toIndex: 0,
    };
  },

  // 复制房间码，方便用户分享给其他成员。
  copyRoomCode() {
    wx.setClipboardData({
      data: (this.data.room && this.data.room.roomCode) || "",
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
    this.setData({
      batchMode: !this.data.batchMode,
      batchSelected: [],
    });
  },

  // 更新批量记分已选成员列表。
  onBatchChange(event) {
    this.setData({
      batchSelected: event.detail.value,
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

  // 处理积分转移选择器变化，并按权限联动目标选项。
  onTransferPicker(event) {
    const { field } = event.currentTarget.dataset;
    const nextValue = Number(event.detail.value);
    if (field === "transferFromIndex") {
      const transferState = this.buildTransferOptions(
        this.data.members,
        this.data.isOwner,
        this.data.currentMemberId,
        nextValue
      );
      this.setData({
        transferFromOptions: transferState.fromOptions,
        transferToOptions: transferState.toOptions,
        transferFromIndex: transferState.fromIndex,
        transferToIndex: transferState.toIndex,
      });
      return;
    }
    this.setData({
      [field]: nextValue,
    });
  },

  // 更新积分转移分值输入。
  onTransferAmountInput(event) {
    this.setData({
      transferAmount: event.detail.value,
    });
  },

  // 提交积分转移请求，云函数负责最终权限和事务校验。
  submitTransfer() {
    if (this.data.submitting) return;
    const from = this.data.transferFromOptions[this.data.transferFromIndex];
    const to = this.data.transferToOptions[this.data.transferToIndex];
    const amount = Number(this.data.transferAmount);
    if (!from || !to) {
      wx.showToast({ title: "请选择转移对象", icon: "none" });
      return;
    }
    if (from.type === to.type && from.memberId === to.memberId) {
      wx.showToast({ title: "来源和目标不能相同", icon: "none" });
      return;
    }
    if (!Number.isInteger(amount) || amount <= 0 || amount > 9999) {
      wx.showToast({ title: "请输入有效分值", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中" });
    callScoreFunction("transferScore", {
      roomId: this.data.roomId,
      fromType: from.type,
      fromMemberId: from.memberId,
      toType: to.type,
      toMemberId: to.memberId,
      amount,
    })
      .then(() => {
        wx.showToast({ title: "已转移", icon: "success" });
        this.setData({ transferAmount: "" });
        return this.loadRoom();
      })
      .catch(showError)
      .finally(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  },

  // 房主撤销最近一次可撤销积分变更。
  undoLastAction() {
    if (this.data.submitting) return;
    wx.showModal({
      title: "撤销最近操作",
      content: "仅撤销最近一次积分变更，并会新增一条撤销记录。",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ submitting: true });
        wx.showLoading({ title: "撤销中" });
        callScoreFunction("undoLastAction", { roomId: this.data.roomId })
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
      title: `加入我的记分房间：${room.name || "简单记分"}`,
      path: `/pages/index/index?roomId=${room._id || this.data.roomId}`,
    };
  },
});
