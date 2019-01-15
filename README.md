# The Ivar Arosenius archive API

Here is the source code for the API for the Ivar Arosenius online archive (http://aroseniusarkivet.org).
The frontend can be found here: https://github.com/CDH-DevTeam/arosenius-archive-gui
The admin system for the database can be found here: https://github.com/CDH-DevTeam/arosenius-archive-gui

### Current server specifications
- Elasticsearch 2.4.6
- Node.js 8.1.4
- Express.js 4.13.4

The API runs on port 3010.

## Getting started

To run the API, first clone the repository or fork it to your own repository. Then install all JS dependencies and start it with `node app.js`.
```
git clone https://github.com/CDH-DevTeam/arosenius-api.git
cd arosenius-api
npm install
node app.js
```

## Elasticsearch

The API depends on Elasticsearch installed and running. Documents are stored as `artwork` mapping type. Mapping definition can be found (here)[https://github.com/CDH-DevTeam/arosenius-api/blob/master/es-artwork-mapping.json].
