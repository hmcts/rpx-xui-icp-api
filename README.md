IN COURT PRESENTATION API
=========================

Repository status
-----------------

The repository README states that this service is being archived while the
delivery report is updated in Grafana. Confirm the current ownership and
support route before making a new production change.

The In Court Presentation API is a Node.js backend service that creates and
manages In Court Presentation sessions initiated by the Media Viewer.


Prerequisites
-------------

- Node.js 24.x or a later version accepted by package.json.
- Yarn 4.18.0.
- Docker and Docker Compose.
- Azure CLI with access to the required HMCTS container registries and
  environments.
- Network access and approved credentials for the services used by the local
  configuration.

On Windows, Git Bash or WSL is recommended for the shell commands in this
document.


Start the local dependencies
----------------------------

Log in to Azure and the required container registries:

    az login
    az acr login --name hmctspublic
    az acr login --name hmctsprivate

Pull the dependency images:

    docker compose -f docker-compose-dependencies.yml pull

Start the local dependency environment:

    ./bin/start-local-environment.sh

The local environment includes Redis and the other dependencies described by
docker-compose-dependencies.yml. Check the container status before starting
the API:

    docker compose -f docker-compose-dependencies.yml ps


Install and run the API
-----------------------

Install project dependencies from the repository root:

    yarn install

Start the service in the default mode:

    yarn start

The local server listens on port 8080 by default. It uses HTTPS when the local
certificate configuration is available and HTTP otherwise. The server logs
the active URL when it starts.

Override the port when required:

    PORT=8080 yarn start


Configuration
-------------

Configuration is loaded with node-config. The main configuration files are in
config/:

- default.yaml: common defaults.
- dev.yaml: local development values.
- test.yaml: test values, including mocked Redis configuration.
- custom-environment-variables.yaml: environment-variable mappings for
  deployed or secret-managed values.

Important configuration areas include Redis, health checks, Web PubSub,
IDAM, service authentication and application telemetry. Do not commit client
secrets, Redis passwords, connection strings or other live credentials.


API documentation and health
----------------------------

Swagger UI is available at:

    http://localhost:8080/swagger

The service exposes a health endpoint at:

    http://localhost:8080/health

The health check includes Redis readiness. A healthy response confirms that
the API can answer the request and that the configured health checks are
passing; it does not prove that every Media Viewer dependency is available.


Tests and quality checks
------------------------

Run unit tests:

    yarn test

Run unit tests with coverage:

    yarn test:coverage

Run the health smoke test:

    yarn test:smoke

Run functional Playwright tests:

    yarn test:functional

The functional command uses the Playwright functional project. Run linting and
the main local checks with:

    yarn lint
    yarn cichecks

Run Sonar analysis when the required Sonar environment is available:

    yarn sonar-scan


Development workflow
--------------------

1. Confirm the repository is still supported and has a current owner.
2. Log in to Azure and the required container registries.
3. Start the dependency stack with Docker Compose.
4. Install dependencies with yarn install.
5. Start the API with yarn start.
6. Check /health and /swagger.
7. Run unit, smoke and functional tests relevant to the change.
8. Review logs and generated test evidence.
9. Keep secrets and generated configuration out of source control.


Troubleshooting
---------------

The API does not start

- Check the Node.js and Yarn versions.
- Check that the dependency containers are running.
- Check the active config files and required secrets.
- Check that port 8080 is free.

Redis health fails

- Check the Redis container and its mapped port.
- Check the Redis host, port, TLS and password values.
- Check that the selected configuration matches the running environment.

Swagger or health is unavailable

- Confirm that the API process is running.
- Confirm the port and protocol shown in the startup log.
- Check local certificate configuration when HTTPS is expected.


Licence
-------

This project is licensed under the MIT Licence.
