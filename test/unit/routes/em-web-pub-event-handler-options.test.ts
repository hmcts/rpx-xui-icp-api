import { expect } from "chai";
import sinon from "sinon";
import { WebPubSubGroup, WebPubSubServiceClient } from "@azure/web-pubsub";
import { ConnectRequest, ConnectResponseHandler, ConnectionContext } from "@azure/web-pubsub-express";
import { EmWebPubEventHandlerOptions } from "../../../api/em-web-pub-event-handler-options";
import { Actions } from "../../../api/model/actions";
import { RedisClient } from "../../../api/redis-client";
import { Session } from "../../../api/model/interfaces";
import { TelemetryClient } from "applicationinsights";

describe("EmWebPubEventHandlerOptions", () => {
  let redisClientStub: sinon.SinonStubbedInstance<RedisClient>;
  let webPubSubServiceClientStub: sinon.SinonStubbedInstance<WebPubSubServiceClient>;
  let emWebPubEventHandlerOptions: EmWebPubEventHandlerOptions;
  let appInsightsStub: { trackTrace: sinon.SinonStub; trackException: sinon.SinonStub };
  const allowedOrigin = "https://manage-case.demo.platform.hmcts.net";

  const createConnectRequest = (origin: string, roleGroup = "caseId--documentId"): ConnectRequest => ({
    context: {
      connectionId: "connectionId",
      eventName: "connect",
      hub: "hub",
      origin: "https://xui-icp-webpubsub.demo.webpubsub.azure.com",
      signature: "signature",
      states: {},
      clientProtocol: "default",
    },
    claims: {
      role: [
        `webpubsub.joinLeaveGroup.${roleGroup}`,
        `webpubsub.sendToGroup.${roleGroup}`,
      ],
    },
    queries: {
      caseId: ["caseId"],
      documentId: ["documentId"],
    },
    headers: {
      origin: [origin],
    },
  });

  const createConnectResponse = (): sinon.SinonStubbedInstance<ConnectResponseHandler> => ({
    setState: sinon.stub(),
    success: sinon.stub(),
    fail: sinon.stub(),
    failWith: sinon.stub(),
  });

  beforeEach(() => {
    redisClientStub = sinon.createStubInstance(RedisClient);
    webPubSubServiceClientStub = sinon.createStubInstance(WebPubSubServiceClient);
    appInsightsStub = { trackTrace: sinon.stub(), trackException: sinon.stub() };
    emWebPubEventHandlerOptions = new EmWebPubEventHandlerOptions(webPubSubServiceClientStub, appInsightsStub as unknown as TelemetryClient, redisClientStub, allowedOrigin);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should allow Web PubSub connections from the configured XUI origin", async () => {
    const response = createConnectResponse();

    await emWebPubEventHandlerOptions.handleConnect(createConnectRequest(allowedOrigin), response);

    expect(response.success.calledOnce).to.be.true;
    expect(response.fail.notCalled).to.be.true;
  });

  it("should reject Web PubSub connections from arbitrary origins", async () => {
    const response = createConnectResponse();

    await emWebPubEventHandlerOptions.handleConnect(createConnectRequest("https://example.com"), response);

    expect(response.success.notCalled).to.be.true;
    expect(response.fail.calledOnceWith(401, "Origin not authorized to access session")).to.be.true;
  });

  it("should reject Web PubSub connections when the XUI origin is not configured", async () => {
    emWebPubEventHandlerOptions = new EmWebPubEventHandlerOptions(webPubSubServiceClientStub, appInsightsStub as unknown as TelemetryClient, redisClientStub, "");
    const response = createConnectResponse();

    await emWebPubEventHandlerOptions.handleConnect(createConnectRequest(allowedOrigin), response);

    expect(response.success.notCalled).to.be.true;
    expect(response.fail.calledOnceWith(401, "Origin not authorized to access session")).to.be.true;
  });

  it("should read the allowed origin from application configuration", () => {
    const config = require("config");
    sinon.stub(config, "has").withArgs("icp.allowedOrigin").returns(true);
    sinon.stub(config, "get").withArgs("icp.allowedOrigin").returns(allowedOrigin);

    const options = new EmWebPubEventHandlerOptions(webPubSubServiceClientStub, appInsightsStub as unknown as TelemetryClient, redisClientStub);
    expect(options.isOriginAllowed(allowedOrigin)).to.be.true;
  });

  it("should reject Web PubSub connections from allowed origins when token roles do not match the requested session", async () => {
    const response = createConnectResponse();

    await emWebPubEventHandlerOptions.handleConnect(createConnectRequest(allowedOrigin, "otherCase--otherDocument"), response);

    expect(response.success.notCalled).to.be.true;
    expect(response.fail.calledOnceWith(401, "User not authorized to access session")).to.be.true;
  });

  it("should remove participant from session", async () => {
    const sessionId = "sessionId";
    const connectionId = "connectionId";
    const caseId = "caseId";
    const documentId = "documentId";
    const session = { participants: JSON.stringify({ [connectionId]: "username" }) };

    redisClientStub.getSessionId.returns(sessionId);
    redisClientStub.getSession.resolves(session as Session);
    redisClientStub.getLock.resolves();
    webPubSubServiceClientStub.group.returns({
      removeConnection: sinon.stub().resolves(),
      sendToAll: sinon.stub().resolves(),
    } as unknown as WebPubSubGroup);

    await emWebPubEventHandlerOptions.onRemoveParticant(connectionId, caseId, documentId);

    expect(redisClientStub.updateParticipants.calledOnce).to.be.true;
    expect(redisClientStub.updateParticipants.calledWith(sessionId, {})).to.be.true;
  });

  it("should remove connection from group", async () => {
    const sessionId = "sessionId";
    const connectionId = "connectionId";
    const caseId = "caseId";
    const documentId = "documentId";
    const session = { participants: JSON.stringify({ [connectionId]: "username" }) };

    redisClientStub.getSessionId.returns(sessionId);
    redisClientStub.getSession.resolves(session as Session);
    redisClientStub.getLock.resolves();
    const groupClientStub = {
      removeConnection: sinon.stub().resolves(),
      sendToAll: sinon.stub().resolves(),
    };
    webPubSubServiceClientStub.group.returns(groupClientStub as unknown as WebPubSubGroup);

    await emWebPubEventHandlerOptions.onRemoveParticant(connectionId, caseId, documentId);

    expect(groupClientStub.removeConnection.calledOnce).to.be.true;
    expect(groupClientStub.removeConnection.calledWith(connectionId)).to.be.true;
  });

  it("should send updated participants list to all clients", async () => {
    const sessionId = "sessionId";
    const connectionId = "connectionId";
    const caseId = "caseId";
    const documentId = "documentId";
    const session = { participants: JSON.stringify({ [connectionId]: "username" }) };

    redisClientStub.getSessionId.returns(sessionId);
    redisClientStub.getSession.resolves(session as Session);
    redisClientStub.getLock.resolves();
    const groupClientStub = {
      removeConnection: sinon.stub().resolves(),
      sendToAll: sinon.stub().resolves(),
    };
    webPubSubServiceClientStub.group.returns(groupClientStub as unknown as WebPubSubGroup);

    await emWebPubEventHandlerOptions.onRemoveParticant(connectionId, caseId, documentId);

    expect(groupClientStub.sendToAll.calledOnce).to.be.true;
    expect(groupClientStub.sendToAll.calledWith({ eventName: Actions.PARTICIPANTS_UPDATED, data: {} })).to.be.true;
  });

  it("should handle connection existence check and remove non-existing connections", async () => {
    const participants = { "conn1": "user1", "conn2": "user2" };
    webPubSubServiceClientStub.connectionExists.withArgs("conn1").resolves(true);
    webPubSubServiceClientStub.connectionExists.withArgs("conn2").resolves(false);

    const result = await emWebPubEventHandlerOptions.checkIfConnectionExistAndRemove(participants);

    expect(result).to.deep.equal({ "conn1": "user1" });
  });

  it("should update presenter when connection is presenter", async () => {
    const session = { presenterId: "conn1", presenterName: "presenter", caseId: "caseId", documentId: "documentId" } as Session;
    const connectionId = "conn1";

    const updatePresenterStub = sinon.stub(emWebPubEventHandlerOptions, "onUpdatePresenter").resolves();

    emWebPubEventHandlerOptions.checkIfConnectionIsPrenseterAndRemove(connectionId, session);

    expect(updatePresenterStub.calledOnce).to.be.true;
    expect(updatePresenterStub.calledWith({ caseId: "caseId", documentId: "documentId", presenterId: "", presenterName: "" })).to.be.true;
  });

  it("should remove an existing participant", async () => {
    const sessionId = "sessionId";
    const connectionId = "connectionId";
    const groupClientStub = {
      removeConnection: sinon.stub().resolves(),
      sendToAll: sinon.stub().resolves(),
    };

    redisClientStub.getSessionId.returns(sessionId);
    redisClientStub.getSession.resolves({ participants: JSON.stringify({ [connectionId]: "username" }) } as Session);
    redisClientStub.getLock.resolves();
    webPubSubServiceClientStub.group.returns(groupClientStub as unknown as WebPubSubGroup);
    webPubSubServiceClientStub.connectionExists.resolves(true);

    await emWebPubEventHandlerOptions.onRemoveParticant(connectionId, "caseId", "documentId");

    expect(redisClientStub.updateParticipants.calledWith(sessionId, {})).to.be.true;
  });

  it("should report participant removal errors", async () => {
    redisClientStub.getSessionId.returns("sessionId");
    redisClientStub.getSession.rejects(new Error("Redis unavailable"));

    await emWebPubEventHandlerOptions.onRemoveParticant("connectionId", "caseId", "documentId");

    expect(appInsightsStub.trackException.calledOnce).to.be.true;
  });

  it("should set and read connection state", () => {
    const response = { setState: sinon.stub(), success: sinon.stub(), fail: sinon.stub() };
    const data = { caseId: "caseId", sessionId: "sessionId", username: "username", documentId: "documentId" };

    emWebPubEventHandlerOptions.setState(response, data);

    expect(response.setState.args).to.deep.equal([
      ["caseId", "caseId"],
      ["documentId", "documentId"],
      ["username", "username"],
    ]);
    const context = { states: { caseId: "caseId", documentId: "documentId", username: "username" } };
    expect(emWebPubEventHandlerOptions.getCaseIdFromState(context as unknown as ConnectionContext)).to.equal("caseId");
    expect(emWebPubEventHandlerOptions.getDocumentIdFromState(context as unknown as ConnectionContext)).to.equal("documentId");
    expect(emWebPubEventHandlerOptions.getUsernameFromState(context as unknown as ConnectionContext)).to.equal("username");
  });
});
