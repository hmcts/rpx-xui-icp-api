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
    expect(nightly).to.include('env.REDIS_HOST = "xui-icp-api-redis-cache-aat.redis.cache.windows.net"');
    expect(values).to.include("REDIS_HOST: xui-icp-api-redis-cache-{{ .Values.global.environment }}.redis.cache.windows.net");
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
});
