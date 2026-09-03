import { expect } from "chai";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRequire } from "module";
import { RouterFinder } from "../../api/router/routerFinder";

const commonJsRequire = createRequire(`${process.cwd()}/test/unit/bootstrap-options.test.ts`);

describe("bootstrap options", () => {
  const config = commonJsRequire("config");
  const redisPath = commonJsRequire.resolve("../../api/redis");
  const moduleCache = commonJsRequire("module")._cache;
  const originalSecrets = config.secrets;
  const originalUseTls = config.redis.useTLS;
  let cachedRedisModule: NodeModule | undefined;

  beforeEach(() => {
    cachedRedisModule = moduleCache[redisPath];
    delete moduleCache[redisPath];
  });

  afterEach(() => {
    config.secrets = originalSecrets;
    config.redis.useTLS = originalUseTls;
    delete moduleCache[redisPath];
    if (cachedRedisModule) {
      moduleCache[redisPath] = cachedRedisModule;
    }
  });

  it("uses TLS and the configured password for Redis", () => {
    config.secrets = { rpx: { "xui-icp-redis-password": "test-password" } };
    config.redis.useTLS = "true";
    const { client } = commonJsRequire("../../api/redis");

    expect(client.options.tls).to.equal(true);
    expect(client.options.password).to.equal("test-password");
  });

  it("uses default Redis options when TLS and secrets are absent", () => {
    config.secrets = undefined;
    config.redis.useTLS = "false";
    const { client } = commonJsRequire("../../api/redis");

    expect(client.options.tls).to.equal(undefined);
    expect(client.options.password).to.not.exist;
  });

  it("loads direct and default router exports", () => {
    const directory = mkdtempSync(join(tmpdir(), "router-finder-"));
    writeFileSync(join(directory, "default.js"), "module.exports = { default: 'default-router' };");
    writeFileSync(join(directory, "direct.js"), "module.exports = 'direct-router';");

    try {
      expect(RouterFinder.findAll(directory)).to.have.members(["default-router", "direct-router"]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
