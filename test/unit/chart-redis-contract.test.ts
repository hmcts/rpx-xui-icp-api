import { expect } from "chai";
import { readFileSync } from "fs";
import { join } from "path";

describe("XUI ICP chart Redis contract", () => {
  it("uses the Redis hostname created for the icp-api component", () => {
    const values = readFileSync(join(process.cwd(), "charts/xui-icp-api/values.yaml"), "utf8");

    expect(values).to.include("REDIS_HOST: xui-icp-api-redis-cache-{{ .Values.global.environment }}.redis.cache.windows.net");
  });
});
