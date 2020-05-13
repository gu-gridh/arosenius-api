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
  dataReadline.on("line", line => {
    artwork = JSON.parse(line)._source;
    sql.query("INSERT INTO `artwork` SET ?", {
      title: artwork.title,
      description: artwork.description
    });
  });
  dataReadline.on("close", () => process.exit(0));
});
