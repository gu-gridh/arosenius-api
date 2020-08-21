# The Ivar Arosenius archive backend

Here is the source code for the backend for the Ivar Arosenius online archive (http://aroseniusarkivet.org).

The frontend can be found here: https://github.com/CDH-DevTeam/arosenius-archive-gui

The admin system for the database can be found here: https://github.com/CDH-DevTeam/arosenius-admin

This documentation also addresses server requirements and server setup.

## Requirements

- MySQL (5.7, other versions may also work)
- Node.js (12.18, other versions may also work)
- GraphicsMagick

The API runs on port 3010 by default, but this can be overridden in config.

## Getting started

To run the backend, first clone the repository or your own fork of it. Then install all JS dependencies, create config files and start it.

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

The ApiDoc documentation in `documentation/` is _very incomplete and oudated_. Improve it or ignore it.

## Images

Images are handled through the [IMGR framework](https://github.com/sydneystockholm/imgr) via Express.js.
It requires [GraphicsMagick](http://www.graphicsmagick.org/README.html) (`gm`).

The server can serve images in an arbitrary resolution which is defined in the url. For example, the image `1.jpg` can be accessed in full resolution via `[url]/images/1.jpg` and in max 1600px resolution via the url `[url]/images/1600x/1.jpg`

Original images are read from the directory specified by `image_path` in the config. It can be an absolute or a relative path. When using the resizing urls, the resulting resized images are stored in the directory specified by `image_temp_path` as a cache.
Note that there is no cleanup or expiry mechanism of resized images, nor any restriction on what sizes can be requested.

## Users

Users are defined in the `users.js` file. All users have the same privileges.

## Data model

The data model for this project began as an Elasticsearch index, before it was converted to MySQL in 2020.
The data structure is still artwork-document-centered, and some other design choices in the model and code are due to this Elasticsearch legacy.

## Adapting to custom data

This database backend is open source, and we encourage you to use it for your own data. If you do, we also recommend using [arosenius-archive-gui](https://github.com/CDH-DevTeam/arosenius-archive-gui) as a user-friendly GUI and [arosenius-admin](https://github.com/CDH-DevTeam/arosenius-admin) for manually managing data entries.

As the data model is quite hard-coded into the code, this requires that you can either structure your data into the same model, or edit the code to fit your data better. See [`arosenius-model.sql`](arosenius-model.sql) for the SQL definition of the data model (schema).
