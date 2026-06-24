const { callScoreFunction, saveRecentRoom, showError } = require("../../utils/api");
const { getRoomProfile } = require("../../utils/profile");

Page({
  data: {
    // 分享路径携带的房间 ID。
    roomId: "",
    // 用户输入或扫码得到的房间码。
    roomCode: "",
    // 加入房间时使用的显示昵称。
    nickname: "",
    // 提交中状态，防止重复加入。
    submitting: false,
  },

  // 接收首页、扫码或分享路径传入的房间参数。
  onLoad(options) {
    const profile = getRoomProfile();
    this.setData({
      roomId: options.roomId || "",
      roomCode: options.roomCode || "",
      nickname: profile.nickname,
    });
  },

  // 根据输入框绑定的 field 更新对应表单字段。
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value,
    });
  },

  // 提交加入房间请求，成功后进入房间详情页。
  submit() {
    if (this.data.submitting) return;
    const roomCode = String(this.data.roomCode || "").trim().toUpperCase();
    const roomId = String(this.data.roomId || "").trim();
    if (!roomCode && !roomId) {
      wx.showToast({
        title: "请输入房间码",
        icon: "none",
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "加入中" });
    const profile = getRoomProfile();
    callScoreFunction("joinRoom", {
      roomId,
      roomCode,
      nickname: String(this.data.nickname || "").trim() || profile.nickname,
    })
      .then((result) => {
        saveRecentRoom({
          roomId: result.roomId,
          roomCode: result.roomCode || roomCode,
          name: "记分房间",
        });
        wx.redirectTo({
          url: `/pages/room/index?roomId=${result.roomId}`,
        });
      })
      .catch(showError)
      .finally(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  },
});
