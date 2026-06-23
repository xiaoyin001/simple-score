function getQueryValue(text, key) {
  const match = String(text || "").match(new RegExp(`[?&]${key}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

Page({
  data: {
    recentRooms: [],
  },

  onLoad(options) {
    const roomId = options.roomId || "";
    const roomCode = options.roomCode || "";
    if (roomId || roomCode) {
      wx.navigateTo({
        url: `/pages/join-room/index?roomId=${roomId}&roomCode=${roomCode}`,
      });
    }
  },

  onShow() {
    this.setData({
      recentRooms: wx.getStorageSync("recentRooms") || [],
    });
  },

  goCreate() {
    wx.navigateTo({
      url: "/pages/create-room/index",
    });
  },

  goJoin() {
    wx.navigateTo({
      url: "/pages/join-room/index",
    });
  },

  goRoom(event) {
    const { roomId } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/room/index?roomId=${roomId}`,
    });
  },

  scanJoin() {
    wx.scanCode({
      scanType: ["qrCode", "barCode"],
      success: (result) => {
        const raw = result.result || "";
        const roomId = getQueryValue(raw, "roomId");
        const roomCode = getQueryValue(raw, "roomCode") || raw.trim();
        wx.navigateTo({
          url: `/pages/join-room/index?roomId=${roomId}&roomCode=${roomCode}`,
        });
      },
      fail: () => {
        wx.showToast({
          title: "未识别到房间码",
          icon: "none",
        });
      },
    });
  },
});
