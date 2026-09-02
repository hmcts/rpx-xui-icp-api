import * as propertiesVolume from "@hmcts/properties-volume";

const config = require("config");
const Redis = require(config.redis.import);
propertiesVolume.addTo(config);

const tlsOptions = {
  password: config.secrets ? config.secrets["em-icp"]["redis-password"] : undefined,
  tls: true,
};
const redisOptions = config.redis.useTLS === "true" ? tlsOptions : {};
export const client = new Redis(config.redis.port, config.redis.host, redisOptions);

client.on("ready", () => {
  console.log("Redis is ready");
});

client.on("error", (err: { message: string; }) => {
  console.log("Error in Redis: ", err.message);
});
