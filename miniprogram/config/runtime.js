// 小程序运行时配置，开发阶段可切换云函数或本地模拟服务。
const runtimeConfig = {
  // 后端调用模式：cloud 使用微信云函数，local 使用本地模拟服务。
  backendMode: "cloud",
  // 指定微信云环境 ID；留空时使用开发者工具当前默认环境。
  cloudEnvId: "",
  // 本地模拟服务地址，需要实现与 scoreFunctions 一致的协议。
  localServerUrl: "http://127.0.0.1:3000/scoreFunctions",
  // 本地模拟用户 openid，用于绕过微信云上下文进行开发调试。
  localMockOpenid: "dev_user_1",
};

module.exports = runtimeConfig;
