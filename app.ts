import * as bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import express from "express";
import * as path from "node:path";
import { RouterFinder } from "./api/router/routerFinder";
import { HttpError } from "./api/model/httpError";
import csrf from "@dr.pogodin/csurf";
import * as propertiesVolume from "@hmcts/properties-volume";
import { swaggerDocument } from "./api/swagger";

import * as appInsights from "applicationinsights";
import * as swaggerUi from "swagger-ui-express";
import { Express, Logger } from "@hmcts/nodejs-logging";
import { EmWebPubEventHandlerOptions } from "./api/em-web-pub-event-handler-options";
import { WebPubSubEventHandler } from "@azure/web-pubsub-express";
import { RedisClient } from "redis-client";
import { WebPubSubServiceClient } from "@azure/web-pubsub";

const healthcheck = require("./api/routes/health");
const helmet = require("helmet");
const noCache = require("nocache");
const config = require("config");
const rateLimit = require("express-rate-limit");

const env = process.env.NODE_ENV || "development";

propertiesVolume.addTo(config);

const APP_INSIGHTS_KEY = config.secrets ? config.secrets["rpx"]["xui-icp-appinsights-instrumentation-key"] : undefined;
const primaryConnectionstring = config.secrets ? config.secrets["rpx"]["xui-icp-web-pubsub-primary-connection-string"] : undefined;

const logger = Logger.getLogger("app");

export const app = express();
app.locals.ENV = env;

const limiter = rateLimit({
  windowMs: config.rateLimit.time,
  max: config.rateLimit.max,
});

if (APP_INSIGHTS_KEY) {
  appInsights.setup(APP_INSIGHTS_KEY)
    .setAutoCollectConsole(true, true)
    .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
    .setSendLiveMetrics(true)
    .start();
  appInsights.defaultClient.context.tags[appInsights.defaultClient.context.keys.cloudRole] = "xui-icp";
}

let appInsightClient;
if(APP_INSIGHTS_KEY) {
  appInsightClient  = appInsights.defaultClient;
}
else {
  appInsightClient = {
    trackTrace: (message: string) => {
      logger.info(message);
    },
    trackEvent: (event: { name: string, properties: { customProperty: unknown } }) => {
      logger.info(event);
    },
  };
}

const redisClient = new RedisClient();
if (primaryConnectionstring) {
  const webPubSubServiceClient = new WebPubSubServiceClient(primaryConnectionstring, "Hub");
  const webPubSubOptions = new EmWebPubEventHandlerOptions(webPubSubServiceClient, appInsightClient, redisClient);
  const handler = new WebPubSubEventHandler("hub", {
    path: "/eventhandler",
    handleConnect: webPubSubOptions.handleConnect,
    handleUserEvent: webPubSubOptions.handleUserEvent,
    onConnected: webPubSubOptions.onConnected,
    onDisconnected: webPubSubOptions.onDisconnected,
  });

  app.use(handler.getMiddleware());
} else {
  logger.warn("Web PubSub connection string not configured; /eventhandler middleware not enabled");
}
app.use("/health", healthcheck);
app.use("/icp/sessions", limiter);
app.use(Express.accessLogger());



app.use("/swagger", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use(noCache());
app.use(helmet());
app.use(helmet.xssFilter({ setOnOldIE: true }));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader(
    "Cache-Control",
    "no-cache, max-age=0, must-revalidate, no-store",
  );
  next();
});

app.use("/", RouterFinder.findAll(path.join(__dirname, "api/routes")));

app.use((req, res) => {
  res.status(404);
  res.send("not-found");
});

app.use((err: HttpError, req: express.Request, res: express.Response) => {
  logger.error(`${err.stack || err}`);

  res.locals.message = err.message;
  res.locals.error = env === "development" ? err : {};
  res.status(err.status || 500);
  res.send("error");
});

if (config.app.useCSRFProtection === "true") {
  app.use(csrf(), (req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    next();
  });
}
