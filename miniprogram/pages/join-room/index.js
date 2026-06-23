const { callScoreFunction, saveRecentRoom, showError } = require("../../utils/api");

Page({
  data: {
    roomId: "",
    roomCode: "",
    nickname: "",
    submitting: false,
  },

  onLoad(options) {
    this.setData({
      roomId: options.roomId || "",
      roomCode: options.roomCode || "",
    });
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value,
    });
  },

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
    callScoreFunction("joinRoom", {
      roomId,
      roomCode,
      nickname: this.data.nickname,
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
