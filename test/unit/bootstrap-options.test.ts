import { expect } from "chai";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRequire } from "module";
import { RouterFinder } from "../../api/router/routerFinder";
import sinon from "sinon";
import Redis from "ioredis";

const commonJsRequire = createRequire(`${process.cwd()}/test/unit/bootstrap-options.test.ts`);

describe("bootstrap options", () => {
  const config = commonJsRequire("config");
  const redisPath = commonJsRequire.resolve("../../api/redis");
  const moduleCache = commonJsRequire("module")._cache;
  const originalSecrets = config.secrets;
  let cachedRedisModule: NodeModule | undefined;

  beforeEach(() => {
    cachedRedisModule = moduleCache[redisPath];
    delete moduleCache[redisPath];
  });

  afterEach(() => {
    config.secrets = originalSecrets;
    sinon.restore();
    delete moduleCache[redisPath];
    if (cachedRedisModule) {
      moduleCache[redisPath] = cachedRedisModule;
    }
  });

  it("uses the managed Redis URL with TLS and its encoded access key", () => {
    config.secrets = { rpx: {
      "xui-icp-managed-redis-connection-string": "rediss://:managed%2Bkey%2F%3D@managed.redis.azure.net:10000",
    } };
    // Use the real ioredis URL parser without opening a network connection.
    const constructor = sinon.stub(moduleCache[commonJsRequire.resolve(config.redis.import)], "exports")
      .callsFake((url: string) => new Redis(url, { lazyConnect: true }));

    const { client } = commonJsRequire("../../api/redis");
    try {
      expect(constructor.calledOnceWithExactly(config.secrets.rpx["xui-icp-managed-redis-connection-string"])).to.be.true;
      expect(client.options.host).to.equal("managed.redis.azure.net");
      expect(Number(client.options.port)).to.equal(10000);
      expect(client.options.password).to.equal("managed+key/=");
      expect(client.options.tls).to.equal(true);
    } finally {
      client.disconnect();
    }
  });

  it("uses local Redis host and port when the managed connection string is absent", () => {
    config.secrets = undefined;
    const { client } = commonJsRequire("../../api/redis");

    expect(client.options.host).to.equal(config.redis.host);
    expect(Number(client.options.port)).to.equal(Number(config.redis.port));
    expect(client.options.tls).to.be.undefined;
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
