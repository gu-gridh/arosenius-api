const fs = require("fs");
const readline = require("readline");
const { insertDocument } = require("./document");

const dataReadline = readline.createInterface({
  input: fs.createReadStream("arosenius_v4.json")
});

let lastChangeTime = Date.now();
let countArtworks = 0;

async function main() {
  dataReadline.on('line', async line => {
    artwork = JSON.parse(line)._source;
    // One particular document is very incomplete.
    if (artwork.id === "PRIV-undefined") return;
    insertDocument(artwork).then(() => {
      lastChangeTime = Date.now()
      process.stdout.write('.')
      countArtworks++
    })
  })
}

main();

// Exit after the last change.
function checkExit() {
  setTimeout(
    () =>
      Date.now() > lastChangeTime + 500
        ? console.log() || console.log(countArtworks) || process.exit()
        : checkExit(),
    100
  );
}
// Allow longer time for the initial queries.
setTimeout(checkExit, 3000);
