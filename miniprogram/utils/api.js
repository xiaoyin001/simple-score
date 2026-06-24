// 统一校验后端返回结构，失败时转成页面可展示的 Error。
function normalizeResult(result) {
  if (!result || !result.success) {
    const error = new Error((result && result.message) || "操作失败");
    if (result && result.code) {
      error.code = result.code;
    }
    throw error;
  }
  return result;
}

// 统一调用记分业务云函数。
function callScoreFunction(type, data = {}) {
  return wx.cloud
    .callFunction({
      name: "scoreFunctions",
      data: {
        type,
        ...data,
      },
    })
    .then((response) => {
      return normalizeResult(response.result || {});
    });
}

// 展示统一错误提示，避免页面重复处理 toast 细节。
function showError(error) {
  wx.showToast({
    title: error.message || "操作失败",
    icon: "none",
    duration: 2200,
  });
}

// 保存最近进入过的房间，首页用于展示快捷入口。
function saveRecentRoom(room) {
  if (!room || !room.roomId) return;
  const current = wx.getStorageSync("recentRooms") || [];
  const next = [
    {
      // 房间 ID，用于直接进入房间详情。
      roomId: room.roomId,
      // 房间码，用于用户识别和再次加入。
      roomCode: room.roomCode,
      // 房间名称，首页最近房间列表展示。
      name: room.name || "记分房间",
      // 本地更新时间，用于排序或后续清理。
      updatedAt: Date.now(),
    },
    ...current.filter((item) => item.roomId !== room.roomId),
  ].slice(0, 5);
  wx.setStorageSync("recentRooms", next);
}

module.exports = {
  callScoreFunction,
  saveRecentRoom,
  showError,
};
