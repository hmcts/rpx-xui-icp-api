import { expect } from "chai";
import { readFileSync } from "fs";
import { join } from "path";

describe("XUI ICP chart Redis contract", () => {
  it("keeps pipeline and chart deployment identities aligned", () => {
    const cnp = readFileSync(join(process.cwd(), "Jenkinsfile_CNP"), "utf8");
    const nightly = readFileSync(join(process.cwd(), "Jenkinsfile_nightly"), "utf8");
    const values = readFileSync(join(process.cwd(), "charts/xui-icp-api/values.yaml"), "utf8");

    expect(cnp).to.include('def component = "icp-api"');
    expect(nightly).to.include('def component = "icp-api"');
    expect(nightly).to.include('env.TEST_URL = "http://xui-icp-aat.service.core-compute-aat.internal"');
    expect(nightly).not.to.include("redis.cache.windows.net");
    expect(values).to.include("- xui-icp-managed-redis-connection-string");
    expect(values).not.to.include("- xui-icp-redis-password");
    expect(values).not.to.include("redis.cache.windows.net");
  });

  it("keeps preview Redis isolated from the managed cache", () => {
    const yaml = require("js-yaml");
    const values = yaml.load(readFileSync(join(process.cwd(), "charts/xui-icp-api/values.yaml"), "utf8"));
    const preview = yaml.load(readFileSync(join(process.cwd(), "charts/xui-icp-api/values.preview.template.yaml"), "utf8"));
    const environmentVariables = yaml.load(readFileSync(join(process.cwd(), "config/custom-environment-variables.yaml"), "utf8"));

    // Helm replaces the base secret list with the preview list.
    expect(preview.nodejs.keyVaults.rpx.secrets).not.to.include("xui-icp-managed-redis-connection-string");
    expect(preview.nodejs.keyVaults.rpx.secrets).to.include("xui-icp-web-pubsub-primary-connection-string");
    expect(preview.nodejs.environment.REDIS_HOST).to.equal("${SERVICE_NAME}-redis-master");
    expect(preview.nodejs.environment.REDIS_PORT).to.equal(6379);
    expect(values.nodejs.environment.REDIS_HOST).to.be.undefined;
    expect(environmentVariables.secrets.rpx["xui-icp-managed-redis-connection-string"]).to.equal("REDIS_CONNECTION_STRING");
  });

  it("keeps the Terraform component identity aligned", () => {
    const variables = readFileSync(join(process.cwd(), "infrastructure/variables.tf"), "utf8");

    expect(variables).to.match(/variable "component"[\s\S]*?default\s*=\s*"icp-api"/);
  });

  it("keeps the Sonar project identity aligned", () => {
    const sonar = readFileSync(join(process.cwd(), "sonar-project.properties"), "utf8");

    expect(sonar).to.include("sonar.projectKey=xui-icp-api");
    expect(sonar).to.include("sonar.projectName=XUI ICP API");
  });

  it("does not deploy unused S2S or generic compatibility secrets", () => {
    const defaultConfig = readFileSync(join(process.cwd(), "config/default.yaml"), "utf8");
    const customEnvironmentVariables = readFileSync(join(process.cwd(), "config/custom-environment-variables.yaml"), "utf8");
    const infrastructure = readFileSync(join(process.cwd(), "infrastructure/main.tf"), "utf8");
    const versions = readFileSync(join(process.cwd(), "infrastructure/versions.tf"), "utf8");
    const values = readFileSync(join(process.cwd(), "charts/xui-icp-api/values.yaml"), "utf8");
    const nightly = readFileSync(join(process.cwd(), "Jenkinsfile_nightly"), "utf8");

    expect(defaultConfig).not.to.include("s2s:");
    expect(customEnvironmentVariables).not.to.include("s2s:");
    expect(defaultConfig).not.to.include('microservice: "em_icp"');
    expect(infrastructure).not.to.match(/microservicekey-(em|xui)-icp/);
    expect(values).not.to.match(/microservicekey-(em|xui)-icp/);
    expect(infrastructure).not.to.match(/name\s*=\s*"AppInsightsInstrumentationKey"/);
    expect(infrastructure).not.to.match(/name\s*=\s*"redis-password"/);
    expect(infrastructure).not.to.include("em-icp-web-pubsub-primary-connection-string");
    expect(values).not.to.include("IDAM_S2S_URL");
    expect(nightly).not.to.include("IDAM_S2S_URL");
    expect(values).to.include("IDAM_API_BASE_URL:");
    expect(nightly).to.include("env.IDAM_API_BASE_URL");
    expect(versions).to.match(/required_version\s*=\s*">=\s*1\.7"/);
  });
});
