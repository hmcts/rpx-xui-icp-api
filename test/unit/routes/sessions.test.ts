// import chai from "chai";
// import chaiHttp from "chai-http";
// import { IdamClient } from "../../../api/security/idam-client";
// import { app } from "../../../app";
// import { client } from "../../../api/redis";
// import sinon from "sinon";
// import { WebPubSubServiceClient } from "@azure/web-pubsub";
// import { EmWebPubEventHandlerOptions } from "em-web-pub-event-handler-options";

// chai.use(chaiHttp);

// describe("/GET sessions", () => {
//   let sandbox;

//   beforeEach(() => {
//     sandbox = sinon.createSandbox();

//     const today = new Date().toDateString();
//     client.hmset("1234", { caseId: "1234", dateOfHearing: today, sessionId: "sessionId" });
//   });

//   afterEach(() => {
//     sandbox.restore();
//   });

//   // it("it should return (200) OK for the same session", (done) => {
//   //   sandbox.stub(IdamClient.prototype, "verifyToken").returns(Promise.resolve());
//   //   sandbox.stub(IdamClient.prototype, "getUserInfo")
//   //     .returns(Promise.resolve({ name: "Test User" }));
//   //   sinon.createStubInstance(WebPubSubServiceClient);
//   //   sandbox.stub(WebPubSubServiceClient.prototype, "getClientAccessToken").returns(Promise.resolve({}));
//   //
//   //   setTimeout(() => {
//   //     chai.request(app)
//   //       .get("/icp/sessions/1234")
//   //       .set("Authorization", "Token")
//   //       .end((err, res) => {
//   //         chai.expect(res.body).to.be.an("object");
//   //         chai.expect(res.body.username).to.equal("Test User");
//   //         chai.expect(res.body.session.caseId).to.equal("1234");
//   //         chai.expect(res.body.session.sessionId).to.equal("sessionId");
//   //         chai.expect(res.status).to.equal(200);
//   //         done();
//   //       });
//   //   });
//   // });

//   // it("it should return (200) OK for a new session", (done) => {
//   //   sandbox.stub(IdamClient.prototype, "verifyToken").returns(Promise.resolve());
//   //   sandbox.stub(IdamClient.prototype, "getUserInfo")
//   //     .returns(Promise.resolve({ name: "Test User" }));
//   //
//   //   setTimeout(() => {
//   //     chai.request(app)
//   //       .get("/icp/sessions/5678")
//   //       .set("Authorization", "Token")
//   //       .end((err, res) => {
//   //         chai.expect(res.body.session.dateOfHearing).not.to.equal("sessionId");
//   //         done();
//   //       });
//   //   });
//   // });

//   it("it should return (401) Unauthorized when invalid Auth token is passed", (done) => {
//     sinon.spy(EmWebPubEventHandlerOptions);
//     setTimeout(() => {
//       chai.request(app)
//         .get("/icp/sessions/1234")
//         .set("Authorization", "Token")
//         .end((err, res) => {
//           chai.expect(res.body).to.be.an("object");
//           chai.expect(res.status).to.equal(401);
//           done();
//         });
//     });
//   });

//   it("it should return (400) Bad Request on null caseId", (done) => {
//     sandbox.stub(IdamClient.prototype, "verifyToken").returns(Promise.resolve());
//     sandbox.stub(IdamClient.prototype, "getUserInfo")
//       .returns(Promise.resolve({ name: "Test User" }));

//     setTimeout(() => {
//       chai.request(app)
//         .get("/icp/sessions/null")
//         .set("Authorization", "Token")
//         .end((err, res) => {
//           chai.expect(res.status).to.equal(400);
//           done();
//         });
//     });
//   });

//   it("it should return (400) Bad Request on undefined caseId", (done) => {
//     sandbox.stub(IdamClient.prototype, "verifyToken").returns(Promise.resolve());
//     sandbox.stub(IdamClient.prototype, "getUserInfo")
//       .returns(Promise.resolve({ name: "Test User" }));

//     setTimeout(() => {
//       chai.request(app)
//         .get("/icp/sessions/undefined")
//         .set("Authorization", "Token")
//         .end((err, res) => {
//           chai.expect(res.status).to.equal(400);
//           done();
//         });
//     });
//   });

//   it("it should return (401) Unauthorized when no Authorization header is passed", (done) => {
//     chai.request(app)
//       .get("/icp/sessions/1234")
//       .end((err, res) => {
//         chai.expect(res.status).to.equal(401);
//         done();
//       });
//   });
// });
