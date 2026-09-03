import axios from "axios";
import { expect } from "chai";
import express from "express";
import { Server } from "http";
import { createRequire } from "module";
import sinon from "sinon";

const commonJsRequire = createRequire(`${process.cwd()}/test/unit/routes/sessions.test.ts`);

type RedisConnection = {
  hgetall: (sessionId: string, callback: (error?: Error, session?: unknown) => void) => void;
  hmset: (...args: unknown[]) => void;
};

describe("GET /icp/sessions/:caseId/:documentId", () => {
  let address: string;
  let server: Server;
  let sandbox: sinon.SinonSandbox;
  let redis: RedisConnection;
  let originalIcp: unknown;
  let originalSecrets: unknown;
  let routerPath: string;
  let cachedRouterModule: NodeModule | undefined;
  const moduleCache = commonJsRequire("module")._cache;

  before(async () => {
    process.env.NODE_ENV = "test";
    process.env.NODE_PATH = ".";
    commonJsRequire("module").Module._initPaths();
    commonJsRequire("tsconfig-paths/register");

    const config = commonJsRequire("config");
    originalIcp = config.icp;
    originalSecrets = config.secrets;
    routerPath = commonJsRequire.resolve("../../../api/routes/sessions");
    cachedRouterModule = moduleCache[routerPath];
    config.secrets = {
      rpx: {
        "xui-icp-web-pubsub-primary-connection-string": "Endpoint=https://example.webpubsub.azure.com;AccessKey=test-key;Version=1.0;",
      },
    };
    config.icp = { wsUrl: "wss://test.example" };

    redis = commonJsRequire("../../../api/redis").client as RedisConnection;
    const router = commonJsRequire("../../../api/routes/sessions");
    const app = express();
    app.use(router);
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
    const { IdamClient } = commonJsRequire("../../../api/security/idam-client");
    const { WebPubSubServiceClient } = commonJsRequire("@azure/web-pubsub");

    sandbox.stub(IdamClient.prototype, "verifyToken").resolves();
    sandbox.stub(IdamClient.prototype, "getUserInfo").resolves({ name: "Test User" });
    sandbox.stub(WebPubSubServiceClient.prototype, "getClientAccessToken").resolves({ token: "test-token" });
  });

  afterEach(() => {
    sandbox.restore();
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    const config = commonJsRequire("config");
    config.icp = originalIcp;
    config.secrets = originalSecrets;
    delete moduleCache[routerPath];
    if (cachedRouterModule) {
      moduleCache[routerPath] = cachedRouterModule;
    }
  });

  const getSession = (caseId: string, documentId: string, authorization = "Bearer token") => axios.get(
    `${address}/icp/sessions/${caseId}/${documentId}`,
    { headers: authorization ? { Authorization: authorization } : {}, validateStatus: () => true },
  );

  const stubRedisSession = (session: unknown, error?: Error) => sandbox.stub(redis, "hgetall").callsFake((_sessionId: string, callback: (callbackError?: Error, callbackSession?: unknown) => void) => callback(error, session));

  it("rejects requests without an authorization header", async () => {
    const response = await getSession("case-1", "document-1", "");

    expect(response.status).to.equal(401);
    expect(response.data).to.deep.equal({ error: "Unauthorized user" });
  });

  it("rejects requests when token verification fails", async () => {
    const { IdamClient } = commonJsRequire("../../../api/security/idam-client");
    sandbox.restore();
    sandbox = sinon.createSandbox();
    sandbox.stub(IdamClient.prototype, "verifyToken").rejects(new Error("verification failed"));

    const response = await getSession("case-1", "document-1");

    expect(response.status).to.equal(401);
  });

  it("rejects invalid case and document identifiers", async () => {
    const invalidCase = await getSession("null", "document-1");
    const invalidDocument = await getSession("case-1", "undefined");

    expect(invalidCase.status).to.equal(400);
    expect(invalidDocument.status).to.equal(400);
  });

  it("reports Redis read failures", async () => {
    stubRedisSession(undefined, new Error("redis unavailable"));

    const response = await getSession("case-1", "document-1");

    expect(response.status).to.equal(500);
  });

  it("creates and persists a session when there is no session for today", async () => {
    stubRedisSession(undefined);
    const persist = sandbox.stub(redis, "hmset");

    const response = await getSession("case-1", "document-1");

    expect(response.status).to.equal(200);
    expect(response.headers["x-access-token"]).to.equal("test-token");
    expect(response.data.username).to.equal("Test User");
    expect(response.data.session).to.include({ caseId: "case-1", documentId: "document-1", connectionUrl: "wss://test.example" });
    expect(persist.calledOnce).to.equal(true);
  });

  it("reuses a session created today without persisting another session", async () => {
    const session = {
      caseId: "case-1",
      dateOfHearing: new Date().toDateString(),
      documentId: "document-1",
      participants: "",
      presenterId: "",
      presenterName: "",
      sessionId: "existing-session",
      connectionUrl: "wss://old.example",
    };
    stubRedisSession(session);
    const persist = sandbox.stub(redis, "hmset");

    const response = await getSession("case-1", "document-1");

    expect(response.status).to.equal(200);
    expect(response.data.session.connectionUrl).to.equal("wss://test.example");
    expect(persist.called).to.equal(false);
  });

  it("still rejects unauthenticated requests when no Web PubSub secret is configured", async () => {
    const config = commonJsRequire("config");
    const configuredSecrets = config.secrets;
    let isolatedServer: Server | undefined;

    try {
      config.secrets = undefined;
      delete moduleCache[routerPath];
      const isolatedApp = express();
      isolatedApp.use(commonJsRequire("../../../api/routes/sessions"));
      isolatedServer = isolatedApp.listen(0);
      await new Promise<void>((resolve) => isolatedServer!.once("listening", resolve));
      const isolatedAddress = isolatedServer.address();
      if (!isolatedAddress || typeof isolatedAddress === "string") {
        throw new Error("Failed to determine isolated test server address");
      }
      const response = await axios.get(`http://127.0.0.1:${isolatedAddress.port}/icp/sessions/case-1/document-1`, {
        validateStatus: () => true,
      });

      expect(response.status).to.equal(401);
    } finally {
      if (isolatedServer) {
        await new Promise<void>((resolve, reject) => isolatedServer!.close((error) => error ? reject(error) : resolve()));
      }
      config.secrets = configuredSecrets;
      delete moduleCache[routerPath];
      if (cachedRouterModule) {
        moduleCache[routerPath] = cachedRouterModule;
      }
    }
  });
});
