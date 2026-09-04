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
  const events = new Map<string, ServerEvent>();
  let connectionId = "";
  let waitingEventName = "";
  let resolveEvent: ((event: ServerEvent) => void) | undefined;

  const connected = new Promise<void>((resolve, reject) => {
    const rejectConnection = (error: Error) => reject(error);
    socket.once("error", rejectConnection);
    socket.once("unexpected-response", (_request, response) => {
      reject(Object.assign(new Error(`Web PubSub upgrade failed with status ${response.statusCode}`), { statusCode: response.statusCode }));
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type?: string; event?: string; connectionId?: string; data?: { eventName?: string; data?: unknown } };
      if (message.type === "system" && message.event === "connected" && message.connectionId) {
        connectionId = message.connectionId;
        socket.off("error", rejectConnection);
        resolve();
      }

      const eventName = message.data?.eventName;
      if (eventName) {
        const event = { eventName, data: message.data?.data };
        if (waitingEventName === eventName && resolveEvent) {
          resolveEvent(event);
          resolveEvent = undefined;
          waitingEventName = "";
        } else {
          events.set(eventName, event);
        }
      }
    });
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
    waitForEvent(eventName, timeoutMs = 10_000) {
      const event = events.get(eventName);
      if (event) {
        events.delete(eventName);
        return Promise.resolve(event);
      }

      return new Promise((resolve, reject) => {
        waitingEventName = eventName;
        const timeout = setTimeout(() => {
          resolveEvent = undefined;
          waitingEventName = "";
          reject(new Error(`Timed out waiting for Web PubSub event ${eventName}`));
        }, timeoutMs);
        resolveEvent = (receivedEvent) => {
          clearTimeout(timeout);
          resolve(receivedEvent);
        };
      });
    },
    async close() {
      if (socket.readyState !== WebSocket.CLOSED) {
        await new Promise<void>((resolve) => {
          socket.once("close", resolve);
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
