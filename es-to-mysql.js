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

let lastChangeTime = Date.now();

sql.query(modelQuery, () => {
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
      (error, results) => {
        lastChangeTime = Date.now();
        process.stdout.write(".");
        artwork.tags &&
          artwork.tags.forEach(tag =>
            sql.query(
              "INSERT INTO `keyword` SET ?",
              {
                artwork: results.insertId,
                type: "tag",
                name: tag
              },
              () => {
                lastChangeTime = Date.now();
                process.stdout.write("-");
              }
            )
          );
      }
    );
  });
});

// Exit 1 s after the last change.
function checkExit() {
  setTimeout(
    () => (Date.now() > lastChangeTime + 1000 ? process.exit() : checkExit()),
    100
  );
}
checkExit();
