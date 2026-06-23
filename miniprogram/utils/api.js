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
      const result = response.result || {};
      if (!result.success) {
        throw new Error(result.message || "操作失败");
      }
      return result;
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
