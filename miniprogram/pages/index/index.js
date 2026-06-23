const { getRuntimeInfo, setLocalMockOpenid } = require("../../utils/api");

// 从扫码结果或分享路径中读取指定查询参数。
function getQueryValue(text, key) {
  const match = String(text || "").match(new RegExp(`[?&]${key}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

Page({
  data: {
    // 最近进入过的房间列表，来自本地缓存。
    recentRooms: [],
    // 本地开发模式下展示模拟用户切换。
    isLocalBackend: false,
    // 当前本地模拟 openid。
    localMockOpenid: "",
    // 开发阶段用于快速模拟多人加入的固定身份。
    localMockUsers: ["dev_user_1", "dev_user_2", "dev_user_3"],
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
    const runtimeInfo = getRuntimeInfo();
    this.setData({
      recentRooms: wx.getStorageSync("recentRooms") || [],
      isLocalBackend: runtimeInfo.backendMode === "local",
      localMockOpenid: runtimeInfo.localMockOpenid,
    });
  },

  // 本地开发阶段切换模拟用户，用于在同一开发工具中测试多人加入和权限差异。
  switchLocalMockUser(event) {
    const { openid } = event.currentTarget.dataset;
    setLocalMockOpenid(openid);
    this.setData({
      localMockOpenid: openid,
    });
    wx.showToast({
      title: `已切换 ${openid}`,
      icon: "none",
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
