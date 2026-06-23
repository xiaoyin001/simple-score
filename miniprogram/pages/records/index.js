const { callScoreFunction, showError } = require("../../utils/api");

// 操作类型到记录页展示文案的映射。
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

// 将记录时间格式化为记录页完整时间。
function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 将原始操作记录转换为记录页展示结构。
function formatRecord(record) {
  const targets = (record.targets || [])
    .map((target) => target.nickname || target.name || (target.type === "public" ? "公共积分池" : "成员"))
    .join("、");
  return {
    ...record,
    displayType: TYPE_LABELS[record.type] || record.type,
    displayTargets: targets || "房间",
    displayTime: formatTime(record.createdAt),
    amountText: record.amount ? `${record.amount}` : "0",
  };
}

Page({
  data: {
    // 当前房间 ID，来自页面参数。
    roomId: "",
    // 房间详情，用于页面标题和上下文展示。
    room: null,
    // 格式化后的操作记录列表。
    records: [],
    // 页面加载状态。
    loading: true,
  },

  // 初始化房间 ID 并加载记录。
  onLoad(options) {
    this.setData({
      roomId: options.roomId || "",
    });
    this.loadRecords();
  },

  // 下拉刷新记录列表。
  onPullDownRefresh() {
    this.loadRecords().finally(() => wx.stopPullDownRefresh());
  },

  // 复用房间详情接口获取最近操作记录。
  loadRecords() {
    this.setData({ loading: true });
    return callScoreFunction("getRoom", { roomId: this.data.roomId })
      .then((result) => {
        this.setData({
          room: result.room,
          records: (result.recentRecords || []).map(formatRecord),
          loading: false,
        });
      })
      .catch((error) => {
        this.setData({ loading: false });
        showError(error);
      });
  },
});
