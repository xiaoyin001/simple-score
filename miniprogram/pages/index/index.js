// 从扫码结果或分享路径中读取指定查询参数。
function getQueryValue(text, key) {
  const match = String(text || "").match(new RegExp(`[?&]${key}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

Page({
  data: {
    // 最近进入过的房间列表，来自本地缓存。
    recentRooms: [],
  },

  // 处理分享路径携带的房间参数，直接进入加入流程。
  onLoad(options) {
    const roomId = options.roomId || "";
    const roomCode = options.roomCode || "";
    if (roomId || roomCode) {
      wx.navigateTo({
        url: `/pages/join-room/index?roomId=${roomId}&roomCode=${roomCode}`,
      });
    }
  },

  // 页面展示时刷新最近房间列表。
  onShow() {
    this.setData({
      recentRooms: wx.getStorageSync("recentRooms") || [],
    });
  },

  // 跳转到创建房间页。
  goCreate() {
    wx.navigateTo({
      url: "/pages/create-room/index",
    });
  },

  // 跳转到手动加入房间页。
  goJoin() {
    wx.navigateTo({
      url: "/pages/join-room/index",
    });
  },

  // 从最近房间列表进入房间详情页。
  goRoom(event) {
    const { roomId } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/room/index?roomId=${roomId}`,
    });
  },

  // 扫描二维码或条码并解析房间码。
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
