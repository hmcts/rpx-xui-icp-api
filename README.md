# Archieving this repo for time been to update the Delivery Report on grafana

# In Court Presentation API
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The In Court Presentation API is a Node Js backend server application that facilitates the creation and management of In Court Presentation sessions initiated from the Media Viewer.

### Setup and running locally
Setup dependencies using Docker Compose:
```
$ az login
$ az acr login --name hmctspublic && az acr login --name hmctsprivate
$ docker-compose -f docker-compose-dependencies.yml pull
$ ./bin/start-local-environment.sh
```

Once the Docker containers have started, open another terminal, install the project dependencies and start the Node js server:
```
$ yarn install
$ yarn start
```

To run the unit tests run the following command:
```
$ yarn test
```

## Swagger UI
To view our REST API go to {HOST}:{PORT}/swagger
> http://localhost:8080/swagger

## Redis

Deployed environments use the `xui-icp-managed-redis-connection-string` secret
from the shared RPX Key Vault. Terraform already provisions this secret with a
`rediss://` URL containing the managed Redis hostname, port and access key.
For an environment without mounted secrets, set `REDIS_CONNECTION_STRING` to
the same URL format. Treat this value as a password.

Local development and preview deployments use `REDIS_HOST` and `REDIS_PORT`
(defaulting to `localhost:6379`). Preview deployments omit the managed Redis
secret so they use their own Redis instance.

Switching caches starts with an empty session store. Existing presentation
sessions must be recreated after deployment. The legacy cache remains
provisioned during the transition.

## Tech

The ICP API uses the following technologies:

- Node (v24.22.1)
- Redis
- Express
- Chai (For testing)
- Mocho (For testing)
