import { WebPubSubServiceClient } from "@azure/web-pubsub";
import { ConnectedRequest, ConnectionContext, ConnectRequest, ConnectResponseHandler, DisconnectedRequest, UserEventRequest, UserEventResponseHandler, WebPubSubEventHandlerOptions } from "@azure/web-pubsub-express";
import { Actions } from "./model/actions";
import { PresenterUpdate, Session } from "model/interfaces";
import { RedisClient } from "./redis-client";
import { TelemetryClient } from "applicationinsights";

const config = require("config");

export class EmWebPubEventHandlerOptions implements WebPubSubEventHandlerOptions {

  private readonly client: WebPubSubServiceClient;
  private readonly appInsightClient: TelemetryClient;
  private readonly redisClient: RedisClient;
  private readonly allowedOrigin?: string;

  constructor(webPubSubServiceClient: WebPubSubServiceClient, appInsightClient: TelemetryClient, redisClient: RedisClient, allowedOrigin?: string) {
    this.client = webPubSubServiceClient;
    this.appInsightClient = appInsightClient;
    this.redisClient = redisClient;
    this.allowedOrigin = allowedOrigin === undefined ? this.getAllowedOrigin() : allowedOrigin.trim();
  }

  handleConnect = async (connectRequest: ConnectRequest, connectResponse: ConnectResponseHandler) => {
    const origin = this.getOriginHeader(connectRequest);
    if (!this.isOriginAllowed(origin)) {
      connectResponse.fail(401, "Origin not authorized to access session");
      return;
    }

    if (connectRequest.claims.role) {
      const roles = this.extractRolesFromConnectRequest(connectRequest);
      const caseId: string = connectRequest.queries.caseId[0];
      const documentId: string = connectRequest.queries.documentId[0];
      const hasAccess = roles.some(element => element.caseId == caseId && element.documentId == documentId);
      if (hasAccess) {
        this.appInsightClient.trackTrace({ message: "handleConnect" });
        connectResponse.success();
        return;
      } else {
        connectResponse.fail(401, "User not authorized to access session");
        return;
      }
    }
    connectResponse.fail(401, "User not authorized to access session");
  };

  isOriginAllowed(origin: string | undefined): boolean {
    return !!origin && !!this.allowedOrigin && origin === this.allowedOrigin;
  }

  private getOriginHeader(connectRequest: ConnectRequest): string | undefined {
    return connectRequest.headers?.origin?.[0] || connectRequest.headers?.Origin?.[0];
  }

  private getAllowedOrigin(): string | undefined {
    return config.has("icp.allowedOrigin") ? `${config.get("icp.allowedOrigin")}`.trim() : undefined;
  }

  extractRolesFromConnectRequest(connectionRequest: ConnectRequest): {
    caseId: string;
    documentId: string;
  }[] {
    return connectionRequest.claims.role.map(role => {
      const parts = role.split(".");
      if (parts.length < 3) return null;
      const [prefix, action, group] = parts;
      const [caseId, documentId] = group.split("--");
      return { prefix, action, caseId, documentId };
    }).filter(Boolean);
  }

  handleUserEvent = async (userEventRequest: UserEventRequest, userEventResponse: UserEventResponseHandler) => {
    if (userEventRequest.context.eventName === Actions.SESSION_JOIN) {
      const data = userEventRequest.data as { caseId: string, sessionId: string, username: string, documentId: string };
      this.setState(userEventResponse, data);
      this.appInsightClient.trackEvent({ name: Actions.SESSION_JOIN, properties: { customProperty: data } });
      await this.onJoin(data, userEventRequest.context.connectionId);
    }
    else if (userEventRequest.context.eventName === Actions.UPDATE_PRESENTER) {
      const change = userEventRequest.data as PresenterUpdate;
      this.appInsightClient.trackEvent({ name: Actions.UPDATE_PRESENTER, properties: { customProperty: change } });
      await this.onUpdatePresenter(change);
    }
    else if (userEventRequest.context.eventName === Actions.UPDATE_SCREEN) {
      const screen = userEventRequest.data as { caseId: string, body: unknown, documentId: string };
      this.appInsightClient.trackEvent({ name: Actions.UPDATE_SCREEN, properties: { customProperty: screen } });
      await this.onUpdateScreen(screen);
    }
    else if (userEventRequest.context.eventName === Actions.REMOVE_PARTICIPANT) {
      const data = userEventRequest.data as { connectionId: string, caseId: string, documentId: string };
      this.appInsightClient.trackEvent({ name: Actions.REMOVE_PARTICIPANT, properties: { customProperty: data } });
      await this.onRemoveParticant(userEventRequest.context.connectionId, data.caseId, data.documentId);
    }
    else if (userEventRequest.context.eventName === Actions.SESSION_LEAVE) {
      const data = userEventRequest.data as { connectionId: string, caseId: string, documentId: string };
      this.appInsightClient.trackEvent({ name: Actions.SESSION_LEAVE, properties: { customProperty: data } });
    }
   
    userEventResponse.success();
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onConnected = async (connectedRequest: ConnectedRequest) => {
    this.appInsightClient.trackTrace({ message: "onConnected" });
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onDisconnected = async(disconnectedRequest: DisconnectedRequest) => {
    const caseId = this.getCaseIdFromState(disconnectedRequest.context);
    const documentId = this.getDocumentIdFromState(disconnectedRequest.context);
    const username = this.getUsernameFromState(disconnectedRequest.context);
    if(caseId && documentId) {
      await this.onRemoveParticant(disconnectedRequest.context.connectionId, caseId, documentId);
    }
    this.appInsightClient.trackTrace({ message: `onDisconnected user:${username}` });
  };

  async onJoin(data: { caseId: string, sessionId: string, username: string, documentId: string }, connectionId: string): Promise<void> {
    const sessionId = this.redisClient.getSessionId(data.caseId, data.documentId);
    const session = await this.redisClient.getSession(sessionId);
    if (session.sessionId !== data.sessionId) {
      return;
    }

    const groupClient = this.client.group(sessionId);

    await groupClient.addConnection(connectionId);

    await this.redisClient.getLock(sessionId);

    const participants = session.participants ? JSON.parse(session.participants) : {};
    participants[connectionId] = data.username;

    await this.checkIfConnectionExistAndRemove(participants);

    await this.redisClient.onJoin(session, participants);

    await this.client.sendToConnection(connectionId, {
      eventName: Actions.CLIENT_JOINED, data: {
        client: { id: connectionId, username: data.username },
        presenter: { id: session.presenterId, username: session.presenterName },
      },
    });


    groupClient.sendToAll({ eventName: Actions.PARTICIPANTS_UPDATED, data: participants });
    groupClient.sendToAll({ eventName: Actions.NEW_PARTICIPANT_JOINED, data: null });
  }

  async checkIfConnectionExistAndRemove(participants: unknown) {
    const participantsConnectionIds = Object.keys(participants);

    for (const connectionId of participantsConnectionIds) {
      const exists = await this.client.connectionExists(connectionId);
      if (!exists) {
        delete participants[connectionId];
      }
    }

    return participants;
  }

  async onUpdatePresenter(change: PresenterUpdate): Promise<void> {
    const sessionId = this.redisClient.getSessionId(change.caseId, change.documentId);
    await this.redisClient.getLock(sessionId);
    await this.redisClient.updatePresenter(change);
    const groupClient = this.client.group(sessionId);

    await groupClient.sendToAll({
      eventName: Actions.PRESENTER_UPDATED, data: { id: change.presenterId, username: change.presenterName },
    });
  }

  async onUpdateScreen(screen: { caseId: string, documentId: string, body: unknown }): Promise<void> {
    const sessionId = this.redisClient.getSessionId(screen.caseId, screen.documentId);
    const groupClient = this.client.group(sessionId);
    groupClient.sendToAll({ eventName: Actions.SCREEN_UPDATED, data: screen.body });
  }

  async onRemoveParticant(connectionId: string, caseId: string, documentId: string): Promise<void> {
    try {
      const sessionId = this.redisClient.getSessionId(caseId, documentId);
      const groupClient = this.client.group(sessionId);
  
      const session = await this.redisClient.getSession(sessionId);
  
      await this.redisClient.getLock(sessionId);
  
      let participants = session.participants ? JSON.parse(session.participants) : {};
  
      participants = await this.checkIfConnectionExistAndRemove(participants);
      this.checkIfConnectionIsPrenseterAndRemove(connectionId, session);
  
      if (Object.prototype.hasOwnProperty.call(participants, connectionId)) {
        delete participants[connectionId];
      }
  
      await groupClient.removeConnection(connectionId);
      await this.client.removeConnectionFromAllGroups(connectionId);
  
      await this.redisClient.updateParticipants(sessionId, participants);
      await groupClient.sendToAll({ eventName: Actions.PARTICIPANTS_UPDATED, data: participants });
    } catch (error) {
      this.appInsightClient.trackException({ exception: error });
    }
  }

  checkIfConnectionIsPrenseterAndRemove(connectionId: string, session: Session) {
    if (connectionId === session.presenterId) {
      session.presenterId = "";
      session.presenterName = "";
      this.onUpdatePresenter({ caseId: session.caseId, documentId: session.documentId, presenterId: "", presenterName: "" } as PresenterUpdate);
    }
  }
  
  setState(userEventResponseHandler: UserEventResponseHandler, data: { caseId: string, sessionId: string, username: string, documentId: string }) {
    userEventResponseHandler.setState("caseId", data.caseId);
    userEventResponseHandler.setState("documentId", data.documentId);
    userEventResponseHandler.setState("username", data.username);
  }

  getCaseIdFromState(context: ConnectionContext): string {
    return context.states["caseId"];
  }

  getDocumentIdFromState(context: ConnectionContext): string {
    return context.states["documentId"];
  }

  getUsernameFromState(context: ConnectionContext): string {
    return context.states["username"];
  }
} 
