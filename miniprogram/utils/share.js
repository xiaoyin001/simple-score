const APP_SHARE_TITLE = "简单记分鸭，快速记录活动积分";
const APP_SHARE_PATH = "/pages/index/index";
const SHARE_IMAGE_URL = "/assets/app-icon.png";

function encodeQueryValue(value) {
  return encodeURIComponent(String(value || ""));
}

function buildQuery(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key])
    .map((key) => `${key}=${encodeQueryValue(params[key])}`)
    .join("&");
}

function buildPath(path, params = {}) {
  const query = buildQuery(params);
  return query ? `${path}?${query}` : path;
}

function enablePageShare() {
  if (typeof wx.showShareMenu !== "function") return;
  wx.showShareMenu({
    withShareTicket: true,
    menus: ["shareAppMessage", "shareTimeline"],
  });
}

function buildAppShareMessage() {
  return {
    title: APP_SHARE_TITLE,
    path: APP_SHARE_PATH,
    imageUrl: SHARE_IMAGE_URL,
  };
}

function buildAppTimelineShare() {
  return {
    title: APP_SHARE_TITLE,
    imageUrl: SHARE_IMAGE_URL,
  };
}

function buildRoomShareMessage(room = {}) {
  const roomId = room._id || room.roomId || "";
  const roomCode = room.roomCode || "";
  return {
    title: `加入我的记分房间：${room.name || "简单记分鸭"}`,
    path: buildPath("/pages/join-room/index", {
      roomId,
      roomCode,
    }),
    imageUrl: SHARE_IMAGE_URL,
  };
}

function buildRoomTimelineShare(room = {}) {
  return {
    title: `一起记录活动积分：${room.name || "简单记分鸭"}`,
    query: buildQuery({
      roomId: room._id || room.roomId || "",
      roomCode: room.roomCode || "",
    }),
    imageUrl: SHARE_IMAGE_URL,
  };
}

module.exports = {
  buildAppShareMessage,
  buildAppTimelineShare,
  buildRoomShareMessage,
  buildRoomTimelineShare,
  enablePageShare,
};
