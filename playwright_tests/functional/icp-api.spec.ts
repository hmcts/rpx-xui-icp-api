import { request as playwrightRequest, test, expect, type APIRequestContext } from "@playwright/test";
import { openWebPubSubClient, withWebPubSubClient } from "./web-pubsub-test-client";

const idamBaseUrl = process.env.IDAM_API_BASE_URL ?? "http://localhost:5000";
const functionalUserEmail = process.env.FUNCTIONAL_TEST_USER_EMAIL ?? "xui-icp-functional@hmcts.net";
const functionalUserPassword = process.env.FUNCTIONAL_TEST_USER_PASSWORD;
const functionalClientSecret = process.env.FUNCTIONAL_TEST_CLIENT_OAUTH_SECRET;

async function requestUserToken(email = functionalUserEmail): Promise<string> {
  if (!functionalUserPassword) {
    throw new Error("FUNCTIONAL_TEST_USER_PASSWORD must be configured for authenticated functional tests");
  }
  if (!functionalClientSecret) {
    throw new Error("FUNCTIONAL_TEST_CLIENT_OAUTH_SECRET must be configured for authenticated functional tests");
  }

  const idam = await playwrightRequest.newContext({ baseURL: idamBaseUrl });
  try {
    const accountResponse = await idam.post("/testing-support/accounts", {
      data: {
        email,
        password: functionalUserPassword,
        forename: "XUI",
        surname: "ICP Functional Test",
        roles: [{ code: "caseworker" }],
      },
    });

    if (![200, 201, 409].includes(accountResponse.status())) {
      throw new Error(`IDAM test account setup failed with status ${accountResponse.status()}`);
    }

    const tokenResponse = await idam.post("/o/token", {
      form: {
        scope: "openid roles profile",
        grant_type: "password",
        redirect_uri: process.env.IDAM_WEBSHOW_WHITELIST ?? "http://localhost:8080/oauth2redirect",
        client_id: "webshow",
        client_secret: functionalClientSecret,
        username: email,
        password: functionalUserPassword,
      },
    });

    if (!tokenResponse.ok()) {
      throw new Error(`IDAM token request failed with status ${tokenResponse.status()}`);
    }

    const token = (await tokenResponse.json()).access_token;
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("IDAM token response did not contain an access token");
    }

    return `Bearer ${token}`;
  } finally {
    await idam.dispose();
  }
}

async function getSession(api: APIRequestContext, caseId: string, documentId: string, token: string) {
  return api.get(`/icp/sessions/${caseId}/${documentId}`, {
    headers: { Authorization: token },
  });
}

test.describe("ICP API functional contracts", () => {
  test("reports a healthy API and Redis dependency", async ({ request }) => {
    const response = await request.get("/health");

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "UP",
      redis: { status: "UP" },
      buildInfo: { name: "xui-icp", project: "xui-icp" },
    });
  });

  test("exposes the API documentation", async ({ request }) => {
    const response = await request.get("/swagger/");

    expect(response.status()).toBe(200);
    await expect(response.text()).resolves.toContain("swagger-ui");
  });

  test("rejects a session request without an Authorization header", async ({ request }) => {
    const response = await request.get("/icp/sessions/playwright-case/playwright-document");

    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized user" });
  });

  test("rejects a session request with an invalid token", async ({ request }) => {
    const response = await request.get("/icp/sessions/playwright-case/playwright-document", {
      headers: { Authorization: "Bearer invalid-playwright-token" },
    });

    expect(response.status()).toBe(401);
  });

  test("rejects a session request with a null case identifier", async ({ request }) => {
    const token = await requestUserToken();
    const response = await getSession(request, "null", "playwright-document", token);

    expect(response.status()).toBe(400);
  });

  test("rejects a session request with an undefined case identifier", async ({ request }) => {
    const token = await requestUserToken();
    const response = await getSession(request, "undefined", "playwright-document", token);

    expect(response.status()).toBe(400);
  });

  test("rejects a session request with a null document identifier", async ({ request }) => {
    const token = await requestUserToken();
    const response = await getSession(request, "playwright-case", "null", token);

    expect(response.status()).toBe(400);
  });

  test("rejects a session request with an undefined document identifier", async ({ request }) => {
    const token = await requestUserToken();
    const response = await getSession(request, "playwright-case", "undefined", token);

    expect(response.status()).toBe(400);
  });

  test("creates and reuses an authenticated hearing session", async ({ request }) => {
    const token = await requestUserToken();
    const caseId = `playwright-case-${Date.now()}`;
    const documentId = "playwright-document";

    const firstResponse = await getSession(request, caseId, documentId, token);
    expect(firstResponse.status()).toBe(200);
    expect(firstResponse.headers()["x-access-token"]).toBeTruthy();

    const firstBody = await firstResponse.json();
    expect(firstBody.username).toEqual(expect.any(String));
    expect(firstBody.session).toMatchObject({
      caseId,
      documentId,
      presenterId: "",
      presenterName: "",
      participants: "",
    });
    expect(firstBody.session.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const secondResponse = await getSession(request, caseId, documentId, token);
    expect(secondResponse.status()).toBe(200);
    await expect(secondResponse.json()).resolves.toMatchObject({
      username: firstBody.username,
      session: { sessionId: firstBody.session.sessionId, caseId, documentId },
    });
  });

  test("proves AAT Web PubSub collaboration between two authenticated users", async ({ request }) => {
    test.skip(process.env.TEST_TYPE !== "aat", "AAT Web PubSub collaboration requires the protected AAT environment");

    const allowedOrigin = process.env.FUNCTIONAL_TEST_ALLOWED_ORIGIN;
    const expectedWebPubSubHost = process.env.FUNCTIONAL_TEST_EXPECTED_WS_HOST;
    if (!allowedOrigin || !expectedWebPubSubHost) {
      throw new Error("FUNCTIONAL_TEST_ALLOWED_ORIGIN and FUNCTIONAL_TEST_EXPECTED_WS_HOST must be configured for AAT collaboration");
    }

    const clientAEmail = functionalUserEmail.replace("@", "-client-a@");
    const clientBEmail = functionalUserEmail.replace("@", "-client-b@");
    const caseId = `playwright-case-${Date.now()}`;
    const documentId = `playwright-document-${Date.now()}`;
    const clientAToken = await requestUserToken(clientAEmail);
    const clientBToken = await requestUserToken(clientBEmail);
    const clientASessionResponse = await getSession(request, caseId, documentId, clientAToken);
    const clientBSessionResponse = await getSession(request, caseId, documentId, clientBToken);

    expect(clientASessionResponse.status()).toBe(200);
    expect(clientBSessionResponse.status()).toBe(200);
    const clientASession = await clientASessionResponse.json();
    const clientBSession = await clientBSessionResponse.json();
    const clientAAccessToken = clientASessionResponse.headers()["x-access-token"];
    const clientBAccessToken = clientBSessionResponse.headers()["x-access-token"];

    expect(new URL(clientASession.session.connectionUrl).hostname).toBe(expectedWebPubSubHost);
    expect(clientASession.session.sessionId).toBe(clientBSession.session.sessionId);
    expect(clientAAccessToken).toBeTruthy();
    expect(clientBAccessToken).toBeTruthy();

    await expect(openWebPubSubClient({
      connectionUrl: clientASession.session.connectionUrl,
      accessToken: clientAAccessToken,
      sessionId: clientASession.session.sessionId,
      caseId,
      documentId,
      origin: "https://example.com",
    })).rejects.toMatchObject({ statusCode: 401 });

    await withWebPubSubClient({
      connectionUrl: clientBSession.session.connectionUrl,
      accessToken: clientBAccessToken,
      sessionId: clientBSession.session.sessionId,
      caseId,
      documentId,
      origin: allowedOrigin,
    }, async (clientB) => {
      await withWebPubSubClient({
        connectionUrl: clientASession.session.connectionUrl,
        accessToken: clientAAccessToken,
        sessionId: clientASession.session.sessionId,
        caseId,
        documentId,
        origin: allowedOrigin,
      }, async (clientA) => {
        const participantsAfterAJoin = clientB.waitForEvent("IcpParticipantsListUpdated");
        await clientA.sendEvent("IcpClientJoinSession", {
          caseId,
          documentId,
          sessionId: clientASession.session.sessionId,
          username: clientASession.username,
        });
        expect(Object.values((await participantsAfterAJoin).data as Record<string, string>)).toEqual([clientASession.username]);
        const participantsAfterJoin = clientB.waitForEvent("IcpParticipantsListUpdated");
        await clientB.sendEvent("IcpClientJoinSession", {
          caseId,
          documentId,
          sessionId: clientBSession.session.sessionId,
          username: clientBSession.username,
        });
        expect(Object.values((await participantsAfterJoin).data as Record<string, string>).sort()).toEqual(
          [clientASession.username, clientBSession.username].sort(),
        );

        const presenterUpdated = clientB.waitForEvent("IcpPresenterUpdated");
        await clientA.sendEvent("IcpNewPresenterStartsPresenting", {
          caseId,
          documentId,
          presenterId: clientA.connectionId,
          presenterName: clientASession.username,
        });
        await expect(presenterUpdated).resolves.toMatchObject({
          data: { id: clientA.connectionId, username: clientASession.username },
        });

        const screenUpdated = clientB.waitForEvent("IcpScreenUpdated");
        await clientA.sendEvent("IcpUpdateScreen", { caseId, documentId, body: { page: 2 } });
        await expect(screenUpdated).resolves.toMatchObject({ data: { page: 2 } });

        const participantsAfterLeave = clientB.waitForEvent("IcpParticipantsListUpdated");
        await clientA.sendEvent("IcpClientLeaveSession", { caseId, documentId, connectionId: clientA.connectionId });
        await clientA.close();
        expect(Object.values((await participantsAfterLeave).data as Record<string, string>)).toEqual([clientBSession.username]);
      });
    });
  });
});
