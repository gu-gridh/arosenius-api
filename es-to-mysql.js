const mysql = require("mysql");
const fs = require("fs");
const readline = require("readline");
const config = require("./config");

const sql = mysql.createConnection({
  ...config.mysql,
  multipleStatements: true
});

const modelQuery = fs.readFileSync("arosenius-model.sql").toString();

const dataReadline = readline.createInterface({
  input: fs.createReadStream("arosenius_v4.json")
});

// sql.query as a promise
function sqlQuery(query, values) {
  return new Promise((resolve, reject) =>
    sql.query(query, values, (error, results) =>
      error ? reject(error) : resolve(results)
    )
  );
}

let lastChangeTime = Date.now();

function insertSet(table, values, char = "") {
  return sqlQuery(`INSERT INTO ${table} SET ?`, values).then(results => {
    lastChangeTime = Date.now();
    process.stdout.write(char);
    return results;
  });
}

async function main() {
  await sqlQuery(modelQuery);

  for await (const line of dataReadline) {
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
    await insertSet("artwork", values, "A").then(async results => {
      const insertKeyword = (type, char) =>
        Promise.all(
          (Array.isArray(artwork[type]) ? artwork[type] : [artwork[type]])
            .filter(x => x)
            .map(async name =>
              insertSet(
                "keyword",
                { artwork: results.insertId, type, name },
                char
              )
            )
        );
      await insertKeyword("type", "y");
      await insertKeyword("tags", "t");
      await insertKeyword("persons", "p");
    });
  }
}

main();

// Exit 1 s after the last change.
function checkExit() {
  setTimeout(
    () => (Date.now() > lastChangeTime + 1000 ? process.exit() : checkExit()),
    100
  );
}
checkExit();
