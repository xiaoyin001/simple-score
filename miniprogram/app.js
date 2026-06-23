// app.js
const runtimeConfig = require("./config/runtime");

App({
  onLaunch: function () {
    this.globalData = {
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
