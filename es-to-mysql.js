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

function insertSet(table, values, char = "", ignoreDuplicate = false) {
  return sqlQuery(`INSERT INTO ${table} SET ?`, values)
    .catch(
      err =>
        (err.code === "ER_DUP_ENTRY" && ignoreDuplicate) || Promise.reject(err)
    )
    .then(results => {
      lastChangeTime = Date.now();
      process.stdout.write(char);
      return results;
    });
}

async function main() {
  // TODO This call seems to cause the for-loop to miss a lot of documents. Run the sql file directly in mysql instead.
  // await sqlQuery(modelQuery);

  for await (const line of dataReadline) {
    artwork = JSON.parse(line)._source;
    // One particular document is very incomplete.
    if (artwork.id === "PRIV-undefined") continue;
    const values = {
      insert_id: artwork.insert_id,
      name: artwork.id,
      title: artwork.title,
      title_en: artwork.title_en,
      subtitle: artwork.subtitle,
      deleted: artwork.deleted || false,
      published: artwork.published || false,
      description: artwork.description,
      museum_int_id: Array.isArray(artwork.museum_int_id)
        ? artwork.museum_int_id.join("|")
        : artwork.museum_int_id,
      museum: artwork.collection && artwork.collection.museum,
      museum_url: artwork.museumLink,
      date_human: artwork.item_date_str,
      date: artwork.item_date_string,
      size: artwork.size ? JSON.stringify(artwork.size) : undefined,
      technique_material: artwork.technique_material,
      acquisition: artwork.acquisition || undefined,
      content: artwork.content,
      inscription: artwork.inscription,
      material: Array.isArray(artwork.material)
        ? artwork.material.pop()
        : undefined,
      creator: artwork.creator,
      signature: artwork.signature,
      // sender set below
      // recipient set below
      literature: artwork.literature,
      reproductions: artwork.reproductions,
      bundle: artwork.bundle
    };

    // Insert persons to reference them.
    for (const f of ["sender", "recipient"].filter(
      f => artwork[f] && (artwork[f].surname || artwork[f].name)
    )) {
      await insertSet(
        "person",
        {
          name: artwork[f].surname
            ? `${artwork[f].firstname} ${artwork[f].surname}`
            : artwork[f].name,
          birth_year: artwork[f].birth_year,
          death_year: artwork[f].death_year
        },
        "P",
        true
      ).then(results => (values[f] = results.insertId));
    }

    await insertSet("artwork", values, "A").then(async results => {
      const insertKeyword = (field, type, char) =>
        Promise.all(
          (Array.isArray(artwork[field]) ? artwork[field] : [artwork[field]])
            .filter(x => x)
            .map(async name =>
              insertSet(
                "keyword",
                { artwork: results.insertId, type, name },
                char
              )
            )
        );
      await Promise.all([
        insertKeyword("type", "type", "y"),
        insertKeyword("genre", "genre", "g"),
        insertKeyword("tags", "tag", "t"),
        insertKeyword("persons", "person", "p"),
        insertKeyword("places", "place", "l"),
        ...artwork.images.map(image =>
          insertSet(
            "image",
            {
              artwork: results.insertId,
              filename: image.image,
              type: image.imagesize.type,
              width: image.imagesize.width,
              height: image.imagesize.height,
              page: image.page && (image.page.number || undefined),
              pageid: image.page && image.page.id,
              order: image.page && (image.page.order || undefined),
              side: image.page && image.page.side,
              color:
                image.googleVisionColors &&
                JSON.stringify(
                  image.googleVisionColors.sort((a, b) => b.score - a.score)[0].color
                )
            },
            "I"
          )
        ),
        ...(artwork.exhibitions || [])
          .filter(s => s)
          .map(s => {
            // "<location>|<year>" or "<location> <year>"
            const match = s.match(/(.*).(\d{4})/);
            insertSet(
              "exhibition",
              {
                artwork: results.insertId,
                location: match[1],
                year: match[2]
              },
              "x"
            );
          })
      ]);
    });
  }
}

main();

// Exit after the last change.
function checkExit() {
  setTimeout(
    () =>
      Date.now() > lastChangeTime + 500
        ? console.log() || process.exit()
        : checkExit(),
    100
  );
}
// Allow longer time for the initial queries.
setTimeout(checkExit, 3000);
