# The Ivar Arosenius archive API

Here is the source code for the API for the Ivar Arosenius online archive (http://aroseniusarkivet.org).

The frontend can be found here: https://github.com/CDH-DevTeam/arosenius-archive-gui

The admin system for the database can be found here: https://github.com/CDH-DevTeam/arosenius-admin

This documentation also addresses server requiremments and server setup.

### Current server specifications

- MySQL 5.7.30
- Node.js 8.1.4
- Express.js 4.13.4

The API runs on port 3010.

## Getting started

To run the API, first clone the repository or fork it to your own repository. Then install all JS dependencies, create `config.js` and `users.js` and start it with `node app.js`.

```sh
git clone https://github.com/CDH-DevTeam/arosenius-api.git
cd arosenius-api
npm install
cp config.demo.js config.js
cp users.demo.js users.js
# Edit config.js and users.js
node app.js
```

## Documentation

The ApiDoc documentation in `documentation/` is _very incomplete and oudated_.

## Images

Images are handled through the [IMGR framework](https://github.com/sydneystockholm/imgr) via Express.js.
It requires [GraphicsMagick](http://www.graphicsmagick.org/README.html) (`gm`).

The server can serve images in different resolutions which is defined in the url. For example, the image privat_diabilder_1904_007.jpg can be access in full resolution via http://cdh-vir-1.it.gu.se:8004/images/privat_diabilder_1904_007.jpg and in max 1600px resolution via the url http://cdh-vir-1.it.gu.se:8004/images/1600x/privat_diabilder_1904_007.jpg

Images are kept in the `/appl/cdh/arosenius-imagedata` folder on the server. Resized images are kept in the `imgr` subfolder for caching purpose.

## Users

Users are defined in the `users.js` file. All users have the same privileges.

## Data model

The data model for this project began as an Elasticsearch index, before it was converted to MySQL in 2020.
The data structure is still artwork-document-centered, and some other design choices in the model and code are due to this Elasticsearch legacy.

### Migrating from Elasticsearch to MySQL

Consider this as documentation for a one-shot operation in the past.

1. Run `npm install` to get new dependencies
2. Run `elasticdump` on the server and scp it to `./arosenius_v4.json`
3. Create a MySQL database locally
   - Make sure to use `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_swedish_ci` (see https://mariadb.com/kb/en/setting-character-sets-and-collations/)
4. Extend `config.js` with the `mysql.*` properties (see `config.demo.js`)
5. Run the data migration:
   - Run the SQL commands in `arosenius-model.sql` to delete (!) and create necessary tables.
   - Run `node es-to-mysql.js`
   - Inspect the MySQL database
   - Improve the script and `arosenius-model.sql`
   - Repeat

## Adapting to custom data

This database backend is open source, and we encourage you to use it for your own data. If you do, we also recommend using [arosenius-archive-gui](https://github.com/CDH-DevTeam/arosenius-archive-gui) as a user-friendly GUI and [arosenius-admin](https://github.com/CDH-DevTeam/arosenius-admin) for manually managing data entries.

As the data model is quite hard-coded into the code, this requires that you can either structure your data into the same model, or edit the code to fit your data better. See [`arosenius-model.sql`](arosenius-model.sql) for the SQL definition of the data model (schema).
