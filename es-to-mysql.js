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

function insertSet(table, values, char = "", done) {
  sql.query(`INSERT INTO ${table} SET ?`, values, (error, results) => {
    if (error) throw error;
    lastChangeTime = Date.now();
    process.stdout.write(char);
    done && done(error, results);
  });
}

sql.query(modelQuery, () => {
  dataReadline.on("line", line => {
    artwork = JSON.parse(line)._source;
    const values = {
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
    };
    insertSet("artwork", values, ".", (error, results) => {
      artwork.tags &&
        artwork.tags.forEach(tag => {
          const values = {
            artwork: results.insertId,
            type: "tag",
            name: tag
          };
          insertSet("keyword", values, "-");
        });
    });
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
