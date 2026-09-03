import { expect } from "chai";
import sinon from "sinon";
import { WebPubSubGroup, WebPubSubServiceClient } from "@azure/web-pubsub";
import { ConnectRequest, ConnectResponseHandler, ConnectedRequest, ConnectionContext, DisconnectedRequest, UserEventRequest, UserEventResponseHandler } from "@azure/web-pubsub-express";
import { EmWebPubEventHandlerOptions } from "../../../api/em-web-pub-event-handler-options";
import { Actions } from "../../../api/model/actions";
import { RedisClient } from "../../../api/redis-client";
import { PresenterUpdate, Session } from "../../../api/model/interfaces";
import { TelemetryClient } from "applicationinsights";

describe("EmWebPubEventHandlerOptions", () => {
  let redisClientStub: sinon.SinonStubbedInstance<RedisClient>;
  let webPubSubServiceClientStub: sinon.SinonStubbedInstance<WebPubSubServiceClient>;
  let emWebPubEventHandlerOptions: EmWebPubEventHandlerOptions;
  let appInsightsStub: { trackEvent: sinon.SinonStub; trackTrace: sinon.SinonStub; trackException: sinon.SinonStub };
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

  const createUserEventRequest = (eventName: string, data: unknown): UserEventRequest => ({
    context: { connectionId: "connectionId", eventName },
    data,
  } as unknown as UserEventRequest);

  const createUserEventResponse = (): sinon.SinonStubbedInstance<UserEventResponseHandler> => ({
    setState: sinon.stub(),
    success: sinon.stub(),
  } as unknown as sinon.SinonStubbedInstance<UserEventResponseHandler>);

  beforeEach(() => {
    redisClientStub = sinon.createStubInstance(RedisClient);
    webPubSubServiceClientStub = sinon.createStubInstance(WebPubSubServiceClient);
    appInsightsStub = { trackEvent: sinon.stub(), trackTrace: sinon.stub(), trackException: sinon.stub() };
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

  it("should allow Web PubSub connections using the capitalized Origin header", async () => {
    const request = createConnectRequest(allowedOrigin);
    request.headers = { Origin: [allowedOrigin] };
    const response = createConnectResponse();

    await emWebPubEventHandlerOptions.handleConnect(request, response);

    expect(response.success.calledOnce).to.be.true;
  });

  it("should reject Web PubSub connections without an origin header", async () => {
    const request = createConnectRequest(allowedOrigin);
    request.headers = undefined;
    const response = createConnectResponse();

    await emWebPubEventHandlerOptions.handleConnect(request, response);

    expect(response.fail.calledOnceWith(401, "Origin not authorized to access session")).to.be.true;
  });

  it("should read the allowed origin from application configuration", () => {
    const config = require("config");
    sinon.stub(config, "has").withArgs("icp.allowedOrigin").returns(true);
    sinon.stub(config, "get").withArgs("icp.allowedOrigin").returns(allowedOrigin);

    const options = new EmWebPubEventHandlerOptions(webPubSubServiceClientStub, appInsightsStub as unknown as TelemetryClient, redisClientStub);
    expect(options.isOriginAllowed(allowedOrigin)).to.be.true;
  });

  it("should reject origins when application configuration has no allowed origin", () => {
    const config = require("config");
    sinon.stub(config, "has").withArgs("icp.allowedOrigin").returns(false);

    const options = new EmWebPubEventHandlerOptions(webPubSubServiceClientStub, appInsightsStub as unknown as TelemetryClient, redisClientStub);

    expect(options.isOriginAllowed(allowedOrigin)).to.be.false;
  });

  it("should reject Web PubSub connections from allowed origins when token roles do not match the requested session", async () => {
    const response = createConnectResponse();

    await emWebPubEventHandlerOptions.handleConnect(createConnectRequest(allowedOrigin, "otherCase--otherDocument"), response);

    expect(response.success.notCalled).to.be.true;
    expect(response.fail.calledOnceWith(401, "User not authorized to access session")).to.be.true;
  });

  it("should reject Web PubSub connections without token roles", async () => {
    const request = createConnectRequest(allowedOrigin);
    (request.claims as { role?: string[] }).role = undefined;
    const response = createConnectResponse();

    await emWebPubEventHandlerOptions.handleConnect(request, response);

    expect(response.fail.calledOnceWith(401, "User not authorized to access session")).to.be.true;
  });

  it("should expose void-returning callbacks to Web PubSub", () => {
    const connectResponse = createConnectResponse();
    const userEventResponse = createUserEventResponse();
    const eventRequest = createUserEventRequest("unknown", {});
    const disconnectedRequest = { context: { connectionId: "connectionId", states: {} } } as unknown as DisconnectedRequest;

    expect(emWebPubEventHandlerOptions.handleConnect(createConnectRequest("https://example.com"), connectResponse)).to.be.undefined;
    expect(emWebPubEventHandlerOptions.handleUserEvent(eventRequest, userEventResponse)).to.be.undefined;
    expect(emWebPubEventHandlerOptions.onConnected({} as ConnectedRequest)).to.be.undefined;
    expect(emWebPubEventHandlerOptions.onDisconnected(disconnectedRequest)).to.be.undefined;
  });

  it("should discard malformed token roles", () => {
    const request = createConnectRequest(allowedOrigin);
    request.claims.role = ["malformed-role"];

    expect(emWebPubEventHandlerOptions.extractRolesFromConnectRequest(request)).to.deep.equal([]);
  });

  it("should route session join events", async () => {
    const data = { caseId: "caseId", sessionId: "sessionId", username: "username", documentId: "documentId" };
    const onJoinStub = sinon.stub(emWebPubEventHandlerOptions, "onJoin").resolves();
    const response = createUserEventResponse();

    await emWebPubEventHandlerOptions.handleUserEvent(createUserEventRequest(Actions.SESSION_JOIN, data), response);

    expect(onJoinStub.calledOnceWith(data, "connectionId")).to.be.true;
    expect(response.success.calledOnce).to.be.true;
  });

  it("should complete user event work after the callback returns void", async () => {
    let resolveJoin: () => void = () => undefined;
    const joinCompletion = new Promise<void>(resolve => {
      resolveJoin = resolve;
    });
    sinon.stub(emWebPubEventHandlerOptions, "onJoin").returns(joinCompletion);
    const response = createUserEventResponse();
    const data = { caseId: "caseId", sessionId: "sessionId", username: "username", documentId: "documentId" };

    expect(emWebPubEventHandlerOptions.handleUserEvent(createUserEventRequest(Actions.SESSION_JOIN, data), response)).to.be.undefined;
    expect(response.success.notCalled).to.be.true;

    resolveJoin();
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(response.success.calledOnce).to.be.true;
  });

  it("should route presenter update events", async () => {
    const data = { caseId: "caseId", documentId: "documentId", presenterId: "presenterId", presenterName: "presenterName" };
    const onUpdatePresenterStub = sinon.stub(emWebPubEventHandlerOptions, "onUpdatePresenter").resolves();
    const response = createUserEventResponse();

    await emWebPubEventHandlerOptions.handleUserEvent(createUserEventRequest(Actions.UPDATE_PRESENTER, data), response);

    expect(onUpdatePresenterStub.calledOnceWith(data)).to.be.true;
    expect(response.success.calledOnce).to.be.true;
  });

  it("should route screen update events", async () => {
    const data = { caseId: "caseId", documentId: "documentId", body: { page: 1 } };
    const onUpdateScreenStub = sinon.stub(emWebPubEventHandlerOptions, "onUpdateScreen").resolves();
    const response = createUserEventResponse();

    await emWebPubEventHandlerOptions.handleUserEvent(createUserEventRequest(Actions.UPDATE_SCREEN, data), response);

    expect(onUpdateScreenStub.calledOnceWith(data)).to.be.true;
    expect(response.success.calledOnce).to.be.true;
  });

  it("should route participant removal events using the event connection", async () => {
    const data = { connectionId: "ignoredConnectionId", caseId: "caseId", documentId: "documentId" };
    const onRemoveParticipantStub = sinon.stub(emWebPubEventHandlerOptions, "onRemoveParticant").resolves();
    const response = createUserEventResponse();

    await emWebPubEventHandlerOptions.handleUserEvent(createUserEventRequest(Actions.REMOVE_PARTICIPANT, data), response);

    expect(onRemoveParticipantStub.calledOnceWith("connectionId", "caseId", "documentId")).to.be.true;
    expect(response.success.calledOnce).to.be.true;
  });

  it("should acknowledge session leave events", async () => {
    const data = { connectionId: "connectionId", caseId: "caseId", documentId: "documentId" };
    const response = createUserEventResponse();

    await emWebPubEventHandlerOptions.handleUserEvent(createUserEventRequest(Actions.SESSION_LEAVE, data), response);

    expect(appInsightsStub.trackEvent.calledOnceWith({ name: Actions.SESSION_LEAVE, properties: { customProperty: data } })).to.be.true;
    expect(response.success.calledOnce).to.be.true;
  });

  it("should acknowledge unknown user events", async () => {
    const response = createUserEventResponse();

    await emWebPubEventHandlerOptions.handleUserEvent(createUserEventRequest("unknown", {}), response);

    expect(appInsightsStub.trackEvent.notCalled).to.be.true;
    expect(response.success.calledOnce).to.be.true;
  });

  it("should trace connected clients", async () => {
    await emWebPubEventHandlerOptions.onConnected({} as ConnectedRequest);

    expect(appInsightsStub.trackTrace.calledOnceWith({ message: "onConnected" })).to.be.true;
  });

  it("should remove disconnected clients with stored case and document state", async () => {
    const onRemoveParticipantStub = sinon.stub(emWebPubEventHandlerOptions, "onRemoveParticant").resolves();

    await emWebPubEventHandlerOptions.onDisconnected({
      context: { connectionId: "connectionId", states: { caseId: "caseId", documentId: "documentId", username: "username" } },
    } as unknown as DisconnectedRequest);

    expect(onRemoveParticipantStub.calledOnceWith("connectionId", "caseId", "documentId")).to.be.true;
    expect(appInsightsStub.trackTrace.calledOnceWith({ message: "onDisconnected user:username" })).to.be.true;
  });

  it("should complete disconnect cleanup after the callback returns void", async () => {
    let resolveRemoval: () => void = () => undefined;
    const removalCompletion = new Promise<void>(resolve => {
      resolveRemoval = resolve;
    });
    const onRemoveParticipantStub = sinon.stub(emWebPubEventHandlerOptions, "onRemoveParticant").returns(removalCompletion);

    expect(emWebPubEventHandlerOptions.onDisconnected({
      context: { connectionId: "connectionId", states: { caseId: "caseId", documentId: "documentId", username: "username" } },
    } as unknown as DisconnectedRequest)).to.be.undefined;
    expect(onRemoveParticipantStub.calledOnce).to.be.true;
    expect(appInsightsStub.trackTrace.notCalled).to.be.true;

    resolveRemoval();
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(appInsightsStub.trackTrace.calledOnceWith({ message: "onDisconnected user:username" })).to.be.true;
  });

  it("should only trace disconnected clients without complete session state", async () => {
    const onRemoveParticipantStub = sinon.stub(emWebPubEventHandlerOptions, "onRemoveParticant").resolves();

    await emWebPubEventHandlerOptions.onDisconnected({ context: { connectionId: "connectionId", states: {} } } as unknown as DisconnectedRequest);

    expect(onRemoveParticipantStub.notCalled).to.be.true;
    expect(appInsightsStub.trackTrace.calledOnceWith({ message: "onDisconnected user:undefined" })).to.be.true;
  });

  it("should not join sessions that do not match the requested session id", async () => {
    redisClientStub.getSessionId.returns("sessionId");
    redisClientStub.getSession.resolves({ sessionId: "differentSessionId" } as Session);

    await emWebPubEventHandlerOptions.onJoin({ caseId: "caseId", sessionId: "sessionId", username: "username", documentId: "documentId" }, "connectionId");

    expect(webPubSubServiceClientStub.group.notCalled).to.be.true;
  });

  it("should join sessions with no existing participants", async () => {
    const session = { sessionId: "sessionId", presenterId: "presenterId", presenterName: "presenterName", participants: "" } as Session;
    const groupClientStub = { addConnection: sinon.stub().resolves(), sendToAll: sinon.stub().resolves() };
    redisClientStub.getSessionId.returns("sessionId");
    redisClientStub.getSession.resolves(session);
    redisClientStub.getLock.resolves();
    redisClientStub.onJoin.resolves();
    webPubSubServiceClientStub.group.returns(groupClientStub as unknown as WebPubSubGroup);
    webPubSubServiceClientStub.connectionExists.resolves(true);
    webPubSubServiceClientStub.sendToConnection.resolves();

    await emWebPubEventHandlerOptions.onJoin({ caseId: "caseId", sessionId: "sessionId", username: "username", documentId: "documentId" }, "connectionId");

    expect(groupClientStub.addConnection.calledOnceWith("connectionId")).to.be.true;
    expect(redisClientStub.onJoin.calledOnceWith(session, { connectionId: "username" })).to.be.true;
  });

  it("should retain existing participants when joining sessions", async () => {
    const session = { sessionId: "sessionId", presenterId: "presenterId", presenterName: "presenterName", participants: JSON.stringify({ existingConnectionId: "existingUser" }) } as Session;
    const groupClientStub = { addConnection: sinon.stub().resolves(), sendToAll: sinon.stub().resolves() };
    redisClientStub.getSessionId.returns("sessionId");
    redisClientStub.getSession.resolves(session);
    redisClientStub.getLock.resolves();
    redisClientStub.onJoin.resolves();
    webPubSubServiceClientStub.group.returns(groupClientStub as unknown as WebPubSubGroup);
    webPubSubServiceClientStub.connectionExists.resolves(true);
    webPubSubServiceClientStub.sendToConnection.resolves();

    await emWebPubEventHandlerOptions.onJoin({ caseId: "caseId", sessionId: "sessionId", username: "username", documentId: "documentId" }, "connectionId");

    expect(redisClientStub.onJoin.calledOnceWith(session, { existingConnectionId: "existingUser", connectionId: "username" })).to.be.true;
  });

  it("should publish presenter updates", async () => {
    const change = { caseId: "caseId", documentId: "documentId", presenterId: "presenterId", presenterName: "presenterName" };
    const groupClientStub = { sendToAll: sinon.stub().resolves() };
    redisClientStub.getSessionId.returns("sessionId");
    redisClientStub.getLock.resolves();
    redisClientStub.updatePresenter.resolves();
    webPubSubServiceClientStub.group.returns(groupClientStub as unknown as WebPubSubGroup);

    await emWebPubEventHandlerOptions.onUpdatePresenter(change as PresenterUpdate);

    expect(redisClientStub.updatePresenter.calledOnceWith(change)).to.be.true;
    expect(groupClientStub.sendToAll.calledOnceWith({ eventName: Actions.PRESENTER_UPDATED, data: { id: "presenterId", username: "presenterName" } })).to.be.true;
  });

  it("should publish screen updates", async () => {
    const screen = { caseId: "caseId", documentId: "documentId", body: { page: 1 } };
    const groupClientStub = { sendToAll: sinon.stub().resolves() };
    redisClientStub.getSessionId.returns("sessionId");
    webPubSubServiceClientStub.group.returns(groupClientStub as unknown as WebPubSubGroup);

    await emWebPubEventHandlerOptions.onUpdateScreen(screen);

    expect(groupClientStub.sendToAll.calledOnceWith({ eventName: Actions.SCREEN_UPDATED, data: screen.body })).to.be.true;
  });

  it("should remove connections when sessions have no participants", async () => {
    const groupClientStub = { removeConnection: sinon.stub().resolves(), sendToAll: sinon.stub().resolves() };
    redisClientStub.getSessionId.returns("sessionId");
    redisClientStub.getSession.resolves({ participants: "" } as Session);
    redisClientStub.getLock.resolves();
    redisClientStub.updateParticipants.resolves();
    webPubSubServiceClientStub.group.returns(groupClientStub as unknown as WebPubSubGroup);
    webPubSubServiceClientStub.removeConnectionFromAllGroups.resolves();

    await emWebPubEventHandlerOptions.onRemoveParticant("connectionId", "caseId", "documentId");

    expect(redisClientStub.updateParticipants.calledOnceWith("sessionId", {})).to.be.true;
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
