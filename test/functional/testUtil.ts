import axios from "axios";
import * as propertiesVolume from "@hmcts/properties-volume";
import { Session } from "../../api/model/interfaces";

const config = require("config");
import { URLSearchParams } from "node:url";
const frontendURL = process.env.TEST_URL || "http://localhost:8080";
const idamUrl = process.env.IDAM_API_BASE_URL || "http://localhost:5000";
const username = "***REMOVED***";
const password = "***REMOVED***";

propertiesVolume.addTo(config);

export class TestUtil {

  static async createIcpSession(token: string, caseId: string): Promise<{ username: string, session: Session }> {
    const headers = { "Authorization": `Bearer ${token}` };
    try {
      const response = await axios.get(`${frontendURL}/icp/sessions/${caseId}`, { headers: headers });
      return response.data;
    } catch (err) {
      console.log("error creating new icp session", err.message);
      throw err;
    }
  }

  static async requestUserToken(): Promise<string> {
    await this.createNewUser();
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const params = new URLSearchParams();
    params.append("scope", "openid roles profile");
    params.append("grant_type", "password");
    params.append("redirect_uri", process.env.IDAM_WEBSHOW_WHITELIST || "http://localhost:8080/oauth2redirect");
    params.append("client_id", "webshow");
    params.append("client_secret", process.env.FUNCTIONAL_TEST_CLIENT_OAUTH_SECRET || "AAAAAAAAAAAAAAAA");
    params.append("username", username);
    params.append("password", password);
    try {
      const response = await axios.post(`${idamUrl}/o/token`, params, { headers });
      return response.data["access_token"];
    } catch (err) {
      console.log("error fetching token");
      throw err;
    }
  }


  static async createNewUser(): Promise<void> {
    const userInfo = {
      forename: "John",
      surname: "Smith",
      email: username,
      password: password,
      roles: [{ code: "caseworker" }],
    };

    try {
      await axios.post(`${idamUrl}/testing-support/accounts`, userInfo)
        .catch(err => console.log(err.message));
    } catch (err) {
      console.log("error creating new user");
      throw err;
    }
  }

  static async waitFor(time): Promise<void> {
    return new Promise(res => setTimeout(res, time));
  }
}
