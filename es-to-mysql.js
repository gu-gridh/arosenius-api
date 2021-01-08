const fs = require("fs");
const { insertDocument } = require("./document");

const lines = fs
	.readFileSync("arosenius_v4.json")
	.toString()
	.split("\n")
	.filter(x => x);

let lastChangeTime = Date.now();
let countArtworks = 0;

// Use instantly invoked function to be able to use `async`.
(async function () {
	for (const line of lines) {
		artwork = JSON.parse(line)._source;
		// One particular document is very incomplete.
		if (artwork.id === "PRIV-undefined") continue;
		await insertDocument(artwork);
		lastChangeTime = Date.now();
		process.stdout.write(".");
		countArtworks++;
	}
	console.log(countArtworks);
	process.exit();
})();
