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

## Tech

The ICP API uses the following technologies:

- Node (v24.22.1)
- Redis
- Express
- Chai (For testing)
- Mocho (For testing)
