import { expect } from "chai";
import sinon from "sinon";
import { client } from "../../api/redis";
import { RedisClient } from "../../api/redis-client";


describe("RedisClient", () => {
  let redisClient, sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    redisClient = new RedisClient();
    client.hmset("1234", { caseId: "1234", sessionId: "sessionId" });
    Object.defineProperty(client, "watch", {
      writable: true,
      value: () => console.log("watching"),
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("it should return the session", async () => {
    const session = await redisClient.getSession("1234");

    expect(session.caseId).to.eq("1234");
  });

  it("it should fail to return the session", async () => {
    sandbox.stub(client, "hgetall").throws(new Error("error"));
    sandbox.spy(redisClient.logger, "error");

    await redisClient.getSession("1234");
    expect(redisClient.logger.error.calledOnce).to.be.true;
  });

  it("it should fail when the session does not exist", async () => {
    sandbox.stub(client, "hgetall").resolves(null);
    sandbox.spy(redisClient.logger, "error");

    await redisClient.getSession("missing");

    expect(redisClient.logger.error.calledOnce).to.be.true;
  });

  it("it should log Redis client errors", () => {
    client.emit("error", { message: "connection error" });
  });

  it("it should lock session with caseId", async () => {
    sandbox.spy(client, "watch");
    await redisClient.getLock("1234");
    expect(client.watch.calledOnce).to.be.true;
  });

  it("it should fail to get lock", async () => {
    sandbox.stub(client, "watch").throws(new Error("locking error"));
    sandbox.spy(redisClient.logger, "error");
    try {
      await redisClient.getLock("1234");
    } catch (err) {
      expect(err.message).to.eq("locking error");
    }
    expect(redisClient.logger.error.calledOnce).to.be.true;
  });

  it("it should set participants and presenter on join", async () => {
    await redisClient.onJoin({ caseId: "1234", presenterId: "presenterId", presenterName: "presenter", documentId: "documentId" }, []);
    const session = await redisClient.getSession("1234--documentId");

    expect(session.presenterId).to.eq("presenterId");
    expect(session.presenterName).to.eq("presenter");
  });

  it("it should fail to update participants on join", async () => {
    sandbox.stub(client, "multi").throws(new Error("error"));
    sandbox.spy(redisClient.logger, "error");

    redisClient.onJoin({} as unknown);
    expect(redisClient.logger.error.calledOnce).to.be.true;
  });

  it("it should update presenter", async () => {
    await redisClient.updatePresenter({ sessionId: "id", caseId: "1234", presenterId: "id", presenterName: "name", documentId: "documentId" });
    const session = await redisClient.getSession("1234--documentId");


    expect(session.presenterId).to.eq("id");
    expect(session.presenterName).to.eq("name");
  });

  it("it should fail to update the presenter", async () => {
    sandbox.stub(client, "multi").throws(new Error("error"));
    sandbox.spy(redisClient.logger, "error");

    await redisClient.updatePresenter({} as unknown);
    expect(redisClient.logger.error.calledOnce).to.be.true;
  });

  it("it should update participants", async () => {
    client.hmset("1234", { caseId: "1234", participants: ["participant1"] });

    await redisClient.updateParticipants("1234", ["participant1", "participant2"]);
    const session = await redisClient.getSession("1234");

    expect(session.participants).to.contain("participant2");
  });

  it("it should fail to update participants", async () => {
    sandbox.stub(client, "multi").throws(new Error("error"));
    sandbox.spy(redisClient.logger, "error");

    await redisClient.updateParticipants("any", []);
    expect(redisClient.logger.error.calledOnce).to.be.true;
  });
});
