const runtimeConfig = require("../config/runtime");

// 统一校验后端返回结构，失败时转成页面可展示的 Error。
function normalizeResult(result) {
  if (!result || !result.success) {
    throw new Error((result && result.message) || "操作失败");
  }
  return result;
}

// 调用本地模拟服务，供开发阶段脱离微信云函数调试页面流程。
function callLocalScoreFunction(type, data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: runtimeConfig.localServerUrl,
      method: "POST",
      header: {
        // 请求内容类型，本地服务按 JSON 解析。
        "content-type": "application/json",
        // 本地模拟 openid，保持权限逻辑仍由后端处理。
        "x-simple-score-openid": runtimeConfig.localMockOpenid,
      },
      data: {
        // 云函数 action 类型。
        type,
        // action 对应的业务入参。
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

// 统一调用记分业务后端，根据运行配置选择云函数或本地服务。
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
