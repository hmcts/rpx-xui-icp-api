import axios from "axios";
import { expect } from "chai";
import { Server } from "http";
import { createRequire } from "module";
import sinon from "sinon";

const commonJsRequire = createRequire(`${process.cwd()}/test/unit/app.test.ts`);

describe("App rate limiting", function () {
  let server: Server;
  let address: string;
  let sandbox: sinon.SinonSandbox;

  before(async function () {
    this.timeout(10000);

    process.env.NODE_ENV = "test";
    process.env.NODE_PATH = ".";
    commonJsRequire("module").Module._initPaths();
    commonJsRequire("tsconfig-paths/register");

    const config = commonJsRequire("config");
    config.secrets = {
      rpx: {
        "xui-icp-web-pubsub-primary-connection-string": "Endpoint=https://example.webpubsub.azure.com;AccessKey=test-key;Version=1.0;",
      },
    };
    config.rateLimit.time = 60000;
    config.rateLimit.max = 1;
    config.icp = { wsUrl: "wss://test.example" };

    const { app } = commonJsRequire("../../app");
    server = app.listen(0);

    await new Promise<void>((resolve) => server.once("listening", resolve));
    const serverAddress = server.address();
    if (!serverAddress || typeof serverAddress === "string") {
      throw new Error("Failed to determine test server address");
    }

    address = `http://127.0.0.1:${serverAddress.port}`;
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const { IdamClient } = commonJsRequire("../../api/security/idam-client");
    const { WebPubSubServiceClient } = commonJsRequire("@azure/web-pubsub");

    sandbox.stub(IdamClient.prototype, "verifyToken").resolves();
    sandbox.stub(IdamClient.prototype, "getUserInfo").resolves({ name: "Test User" });
    sandbox.stub(WebPubSubServiceClient.prototype, "getClientAccessToken").resolves({ token: "test-token" });
  });

  afterEach(() => {
    sandbox.restore();
  });

  after(async function () {
    this.timeout(10000);

    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(undefined);
      });
    });
  });

  it("does not rate limit health checks", async () => {
    const firstResponse = await axios.get(`${address}/health`, { validateStatus: () => true });
    const secondResponse = await axios.get(`${address}/health`, { validateStatus: () => true });

    expect(firstResponse.status).to.not.equal(429);
    expect(secondResponse.status).to.not.equal(429);
  });

  it("reports healthy when Redis is ready", async () => {
    const { client: redis } = commonJsRequire("../../api/redis");
    const status = redis.status;
    redis.status = "ready";

    try {
      const response = await axios.get(`${address}/health`, { validateStatus: () => true });

      expect(response.status).to.equal(200);
    } finally {
      redis.status = status;
    }
  });

  it("rate limits session requests", async () => {
    const headers = { Authorization: "Bearer token" };

    const firstResponse = await axios.get(`${address}/icp/sessions/1234/document-1`, { headers });
    expect(firstResponse.status).to.equal(200);

    await axios.get(`${address}/icp/sessions/1234/document-1`, { headers })
      .then(() => {
        throw new Error("Expected request to be rate limited");
      })
      .catch((error) => {
        expect(error.response.status).to.equal(429);
      });
  });
});
