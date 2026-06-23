// 小程序入口，负责初始化云开发环境。
const runtimeConfig = require("./config/runtime");

App({
  // 小程序启动时根据运行模式初始化全局环境。
  onLaunch: function () {
    this.globalData = {
      // 当前云环境 ID，供云调用初始化使用。
      env: runtimeConfig.cloudEnvId,
    };
    if (runtimeConfig.backendMode === "local") {
      return;
    }
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      const env = this.globalData.env || undefined;
      wx.cloud.init({
        env,
        traceUser: true,
      });
    }
  },
});
