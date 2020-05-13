const elasticsearch = require("elasticsearch");
const mysql = require("mysql");
const fs = require("fs");
const readline = require("readline");

const config = require("./config");

const es = new elasticsearch.Client({
  host: config.es_host
});

const sql = mysql.createConnection({
  ...config.mysql,
  multipleStatements: true
});

const modelQuery = fs.readFileSync("arosenius-model.sql").toString();

const dataReadline = readline.createInterface({
  input: fs.createReadStream("arosenius_v4.json")
});

sql.query(modelQuery, () => {
  console.log(
    "Each dot is a record created. Cancel (Ctrl+C) when no more dots."
  );
  dataReadline.on("line", line => {
    artwork = JSON.parse(line)._source;
    sql.query(
      "INSERT INTO `artwork` SET ?",
      {
        name: artwork.id,
        title: artwork.title,
        description: artwork.description,
        museum: artwork.collection && artwork.collection.museum,
        archive_physloc:
          artwork.collection &&
          artwork.collection.archive_item &&
          artwork.collection.archive_item.archive_physloc,
        archive_title:
          artwork.collection &&
          artwork.collection.archive_item &&
          artwork.collection.archive_item.title
      },
      err => process.stdout.write(".")
    );
  });
});
