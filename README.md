# The Ivar Arosenius archive API

Here is the source code for the API for the Ivar Arosenius online archive (http://aroseniusarkivet.org).

The frontend can be found here: https://github.com/CDH-DevTeam/arosenius-archive-gui

The admin system for the database can be found here: https://github.com/CDH-DevTeam/arosenius-admin

This documentation also addresses server requiremments and server setup.

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

The API depends on Elasticsearch installed and running. Documents are stored as `artwork` mapping type. Mapping definition can be found [here](https://github.com/CDH-DevTeam/arosenius-api/blob/master/es-artwork-mapping.json).

## Images

Images are handled through the (IMGR framework)[https://github.com/sydneystockholm/imgr] via Express.js.

The server can serve images in different resolutions which is defined in the url. For example, the image privat_diabilder_1904_007.jpg can be access in full resolution via http://cdh-vir-1.it.gu.se:8004/images/privat_diabilder_1904_007.jpg and in max 1600px resolution via the url http://cdh-vir-1.it.gu.se:8004/images/1600x/privat_diabilder_1904_007.jpg

Images are kept in the `/appl/cdh/arosenius-imagedata` folder on the server. Resized images are kept in the `imgr` subfolder for caching purpose.

## Users

Users are defined in the `users.js` file. All users have the same privileges.
