import WebSocket from "ws";

type WebPubSubClientOptions = {
  connectionUrl: string;
  accessToken: string;
  sessionId: string;
  caseId: string;
  documentId: string;
  origin: string;
};

type ServerEvent = { eventName: string; data: unknown };

type PendingEvent = {
  eventName: string;
  resolve: (event: ServerEvent) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const EVENT_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 5_000;

export type WebPubSubTestClient = {
  readonly connectionId: string;
  sendEvent(event: string, data: unknown): Promise<void>;
  waitForEvent(eventName: string, timeoutMs?: number): Promise<ServerEvent>;
  close(): Promise<void>;
};

export async function openWebPubSubClient(options: WebPubSubClientOptions): Promise<WebPubSubTestClient> {
  const url = new URL(options.connectionUrl);
  url.searchParams.set("access_token", options.accessToken);
  url.searchParams.set("sessionId", options.sessionId);
  url.searchParams.set("caseId", options.caseId);
  url.searchParams.set("documentId", options.documentId);

  const socket = new WebSocket(url, "json.webpubsub.azure.v1", { headers: { Origin: options.origin } });
  let connectionId = "";
  let pendingEvent: PendingEvent | undefined;
  let resolveConnection: (() => void) | undefined;
  let rejectConnection: ((error: Error) => void) | undefined;
  let connectionTimeout: NodeJS.Timeout | undefined;
  let socketFailure: Error | undefined;

  const finishConnection = (error?: Error) => {
    if (!resolveConnection || !rejectConnection) {
      return;
    }
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
    }
    const resolve = resolveConnection;
    const reject = rejectConnection;
    resolveConnection = undefined;
    rejectConnection = undefined;
    if (error) {
      reject(error);
    } else {
      resolve();
    }
  };

  const rejectPendingEvent = (error: Error) => {
    if (!pendingEvent) {
      return;
    }
    clearTimeout(pendingEvent.timeout);
    const { reject } = pendingEvent;
    pendingEvent = undefined;
    reject(error);
  };

  socket.on("error", (error) => {
    socketFailure = error;
    finishConnection(error);
    rejectPendingEvent(error);
  });
  socket.on("close", () => {
    const error = new Error("Web PubSub socket closed");
    socketFailure ??= error;
    finishConnection(error);
    rejectPendingEvent(error);
  });
  socket.once("unexpected-response", (_request, response) => {
    finishConnection(Object.assign(new Error(`Web PubSub upgrade failed with status ${response.statusCode}`), { statusCode: response.statusCode }));
  });
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as { type?: string; event?: string; connectionId?: string; data?: { eventName?: string; data?: unknown } };
    if (message.type === "system" && message.event === "connected" && message.connectionId) {
      connectionId = message.connectionId;
      finishConnection();
    }

    const eventName = message.data?.eventName;
    if (eventName && pendingEvent?.eventName === eventName) {
      clearTimeout(pendingEvent.timeout);
      const { resolve } = pendingEvent;
      pendingEvent = undefined;
      resolve({ eventName, data: message.data?.data });
    }
  });

  const connected = new Promise<void>((resolve, reject) => {
    resolveConnection = resolve;
    rejectConnection = reject;
    connectionTimeout = setTimeout(() => finishConnection(new Error("Timed out waiting for Web PubSub connection")), EVENT_TIMEOUT_MS);
  });

  await connected;
  return {
    get connectionId() {
      return connectionId;
    },
    sendEvent(event, data) {
      return new Promise((resolve, reject) => {
        socket.send(JSON.stringify({ type: "event", event, data }), (error) => error ? reject(error) : resolve());
      });
    },
    waitForEvent(eventName, timeoutMs = EVENT_TIMEOUT_MS) {
      if (socketFailure) {
        return Promise.reject(socketFailure);
      }
      if (pendingEvent) {
        return Promise.reject(new Error(`Already waiting for Web PubSub event ${pendingEvent.eventName}`));
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (pendingEvent?.eventName === eventName) {
            pendingEvent = undefined;
            reject(new Error(`Timed out waiting for Web PubSub event ${eventName}`));
          }
        }, timeoutMs);
        pendingEvent = { eventName, resolve, reject, timeout };
      });
    },
    async close() {
      if (socket.readyState !== WebSocket.CLOSED) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            socket.terminate();
            resolve();
          }, CLOSE_TIMEOUT_MS);
          socket.once("close", () => {
            clearTimeout(timeout);
            resolve();
          });
          socket.close();
        });
      }
    },
  };
}

export async function withWebPubSubClient<T>(options: WebPubSubClientOptions, use: (client: WebPubSubTestClient) => Promise<T>): Promise<T> {
  const client = await openWebPubSubClient(options);
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}
