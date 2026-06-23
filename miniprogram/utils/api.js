const runtimeConfig = require("../config/runtime");

function normalizeResult(result) {
  if (!result || !result.success) {
    throw new Error((result && result.message) || "操作失败");
  }
  return result;
}

function callLocalScoreFunction(type, data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: runtimeConfig.localServerUrl,
      method: "POST",
      header: {
        "content-type": "application/json",
        "x-simple-score-openid": runtimeConfig.localMockOpenid,
      },
      data: {
        type,
        ...data,
      },
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`本地服务请求失败：${response.statusCode}`));
          return;
        }
        try {
          resolve(normalizeResult(response.data));
        } catch (error) {
          reject(error);
        }
      },
      fail(error) {
        reject(new Error(error.errMsg || "本地服务连接失败"));
      },
    });
  });
}

function callScoreFunction(type, data = {}) {
  if (runtimeConfig.backendMode === "local") {
    return callLocalScoreFunction(type, data);
  }

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

function showError(error) {
  wx.showToast({
    title: error.message || "操作失败",
    icon: "none",
    duration: 2200,
  });
}

function saveRecentRoom(room) {
  if (!room || !room.roomId) return;
  const current = wx.getStorageSync("recentRooms") || [];
  const next = [
    {
      roomId: room.roomId,
      roomCode: room.roomCode,
      name: room.name || "记分房间",
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
