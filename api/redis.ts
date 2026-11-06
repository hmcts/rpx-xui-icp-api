import * as propertiesVolume from "@hmcts/properties-volume";

const config = require("config");
const Redis = require(config.redis.import);
propertiesVolume.addTo(config);

const connectionString = config.secrets?.rpx?.["xui-icp-managed-redis-connection-string"];
const redisOptions = config.redis.useTLS === "true" ? {
  password: config.secrets?.rpx?.["xui-icp-redis-password"],
  tls: true,
} : {};
export const client = connectionString
  ? new Redis(connectionString)
  : new Redis(config.redis.port, config.redis.host, redisOptions);

client.on("ready", () => {
  console.log("Redis is ready");
});

client.on("error", (err: { message: string; }) => {
  console.log("Error in Redis: ", err.message);
});
