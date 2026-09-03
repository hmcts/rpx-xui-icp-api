import { request as playwrightRequest, test, expect, type APIRequestContext } from "@playwright/test";

const idamBaseUrl = process.env.IDAM_API_BASE_URL ?? "http://localhost:5000";
const functionalUserEmail = process.env.FUNCTIONAL_TEST_USER_EMAIL ?? "xui-icp-functional@hmcts.net";
const functionalUserPassword = process.env.FUNCTIONAL_TEST_USER_PASSWORD;
const functionalClientSecret = process.env.FUNCTIONAL_TEST_CLIENT_OAUTH_SECRET;

async function requestUserToken(): Promise<string> {
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
        email: functionalUserEmail,
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
        username: functionalUserEmail,
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
    });
  });

  test("rejects a session request without an Authorization header", async ({ request }) => {
    const response = await request.get("/icp/sessions/playwright-case/playwright-document");

    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized user" });
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
});
