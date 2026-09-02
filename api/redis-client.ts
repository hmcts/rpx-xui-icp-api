import { Logger } from "@hmcts/nodejs-logging";
import { PresenterUpdate, Session } from "./model/interfaces";
import { client } from "./redis";

export class RedisClient {

  logger = Logger.getLogger("redis-client");

  async getSession(sessionId: string): Promise<Session> {
    try {
      const session = await client.hgetall(sessionId);
      if (!session) {
        throw new Error("session not found");
      }
      return session;
    } catch (err) {
      this.logger.error(err);
    }
  }

  async getLock(sessionId: string): Promise<void> {
    try {
      await client.watch(sessionId);
    } catch (watchError) {
      this.logger.error("Error watching caseId: ", watchError);
      throw watchError;
    }
  }

  async onJoin(session: Session, participants: unknown): Promise<void> {
    try {
      await client.multi()
        .hset(this.getSessionId(session.caseId, session.documentId), "participants", JSON.stringify(participants))
        .hset(this.getSessionId(session.caseId, session.documentId), "presenterId", session.presenterId)
        .hset(this.getSessionId(session.caseId, session.documentId), "presenterName", session.presenterName)
        .exec();
    } catch (err) {
      this.logger.error("Error executing changes in Redis: ", err);
    }
  }

  async updatePresenter(change: PresenterUpdate): Promise<void> {
    try {
      await client.multi()
        .hset(this.getSessionId(change.caseId, change.documentId), "presenterId", change.presenterId)
        .hset(this.getSessionId(change.caseId, change.documentId), "presenterName", change.presenterName)
        .exec();
    } catch (err) {
      this.logger.error("Error executing changes in Redis: ", err);
    }
  }

  async updateParticipants(sessionId: string, participants: unknown): Promise<void> {
    try {
      await client.multi()
        .hset(sessionId, "participants", JSON.stringify(participants))
        .exec();
    } catch (err) {
      this.logger.error("Error executing changes in Redis: ", err);
    }
  }

  getSessionId(caseId: string, documentId: string): string {
    return `${caseId}--${documentId}`;
  }
}
