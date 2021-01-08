var _ = require("underscore");
const config = require("./config");
const knex = require("knex")({
	// debug: true,
	client: "mysql",
	connection: config.mysql
});

/** All the verbose code for storing and retreiving from MySQL and converting to/from artwork-centric document objects. */

/**
 * Insert a new artwork.
 *
 * Some parts of this code are motivated by inconsistencies in imported Elasticsearch data.
 */
async function insertDocument(artwork) {
	const values = formatArtworkRow(artwork);

	// Insert persons to reference them.
	values.sender = await ensurePerson(artwork.sender);
	values.recipient = await ensurePerson(artwork.recipient);

	const insertIds = await knex("artwork").insert(noUndefined(values));
	const artworkId = insertIds[0];

	function insertKeyword(field, type) {
		return Promise.all(
			(Array.isArray(artwork[field]) ? artwork[field] : [artwork[field]])
				.filter(x => x)
				.map(name =>
					knex("keyword").insert({
						artwork: artworkId,
						type,
						name
					})
				)
		);
	}
	return await Promise.all([
		insertKeyword("type", "type"),
		insertKeyword("genre", "genre"),
		insertKeyword("tags", "tag"),
		insertKeyword("persons", "person"),
		insertKeyword("places", "place"),
		...artwork.images.map(image =>
			knex("image").insert(formatImageRow(artworkId, image))
		)
	]);
}

/**
 * Update an existing artwork.
 */
async function updateDocument(artwork) {
	const values = formatArtworkRow(artwork);

	// Insert persons to reference them.
	values.sender = await ensurePerson(artwork.sender);
	values.recipient = await ensurePerson(artwork.recipient);

	await knex("artwork").where({ insert_id: artwork.id }).update(values);
	const artworkId = await knex("artwork")
		.where({ insert_id: artwork.id })
		.pluck("id");

	// Insert and delete keywords and images.
	async function updateKeywords(field, type) {
		const rows = await knex("keyword")
			.pluck("name")
			.where({ artwork: artworkId, type });
		const inserts = (artwork[field] || [])
			.filter(x => !rows.includes(x))
			.map(name => knex("keyword").insert({ artwork: artworkId, type, name }));
		const deletes = rows
			.filter(x => !artwork[field].includes(x))
			.map(name =>
				knex("keyword").where({ artwork: artworkId, type, name }).delete()
			);
		// Return a promise of the promises.
		return Promise.all(inserts.concat(deletes));
	}

	return await Promise.all([
		updateKeywords("type", "type"),
		updateKeywords("genre", "genre"),
		updateKeywords("tags", "tag"),
		updateKeywords("persons", "person"),
		updateKeywords("places", "place"),
		updateImages(artworkId, artwork.images)
	]);
}

/** Ensure a sender/recipient exists, and return its id. */
async function ensurePerson(person) {
	if (!person || !(person.surname || person.name)) return null;
	return await ensure("person", ["name"], {
		name: person.surname
			? `${person.firstname} ${person.surname}`
			: person.name,
		birth_year: person.birth_year,
		death_year: person.death_year
	});
}

/** Format most of the fields for a row in the artwork table, using an Elasticsearch-formatted object. */
function formatArtworkRow(artwork) {
	return {
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
		exhibitions:
			artwork.exhibitions && artwork.exhibitions.length
				? JSON.stringify(
						artwork.exhibitions
							.filter(s => s)
							.map(s => {
								// "<location>|<year>" or "<location> <year>"
								const match = s.match(/(.*)(.(\d{4}))?/);
								return {
									location: match[1],
									year: match[3]
								};
							})
				  )
				: undefined,
		literature: artwork.literature,
		reproductions: artwork.reproductions,
		bundle: artwork.bundle,
		bundle_order: artwork.page && artwork.page.order,
		bundle_side: artwork.page && artwork.page.side
	};
}

/**
 * Ensure (find or insert) a row and return its (existing or new) id.
 *
 * This is not an upsert, it does not update any existing rows.
 */
async function ensure(table, uniqueCols, row) {
	// Find a row by the unique columns.
	const rows = await knex(table).select("id").where(_.pick(row, uniqueCols));
	if (rows.length) return rows[0].id;
	// If not found, insert the full row.
	const insertIds = await knex(table).insert(row);
	return insertIds[0];
}

/** Format the fields for a row in the image table, using an Elasticsearch-formatted object. */
function formatImageRow(artworkId, image) {
	return noUndefined({
		artwork: artworkId,
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
	});
}

/** Update the list of images for a given artwork. */
async function updateImages(artworkId, images) {
	const existing = await knex("image")
		.select("*")
		.where({ artwork: artworkId });
	// Insert images. For images that already exist, update them.
	const upserts = (images || []).map(image =>
		knex("image")
			.insert(formatImageRow(artworkId, image))
			.catch(err =>
				err.code === "ER_DUP_ENTRY"
					? knex("image")
							.where({ artwork: artworkId, filename: image.image })
							.update(formatImageRow(artworkId, image))
					: Promise.reject(err)
			)
	);
	// Delete images that are not in the incoming data.
	const deletes = existing
		.filter(e => !images.find(i => i.image === e.filename))
		.map(image =>
			knex("image")
				.where({ artwork: artworkId, filename: image.image })
				.delete()
		);
	// Return a promise of the promises.
	return Promise.all(upserts.concat(deletes));
}

/** Load a document from the database and format it. */
async function loadDocuments(insert_ids, includeInternalId = false) {
	// Convert legacy ids (aka names) to insert_id, e.g. "PRIV-4844" to "4844"
	insert_ids = insert_ids.map(id => id.replace(/[A-Za-z]+-/, ""));
	const artworks = await knex("artwork")
		.leftJoin({ sender: "person" }, "artwork.sender", "sender.id")
		.leftJoin({ recipient: "person" }, "artwork.recipient", "recipient.id")
		.select("artwork.*", {
			// Rename person columns to avoid collision.
			sender_name: "sender.name",
			sender_birth_year: "sender.birth_year",
			sender_death_year: "sender.death_year",
			recipient_name: "recipient.name",
			recipient_birth_year: "recipient.birth_year",
			recipient_death_year: "recipient.death_year"
		})
		.whereIn("artwork.insert_id", insert_ids)
		.orderByRaw("FIND_IN_SET(??, ?)", [
			"artwork.insert_id",
			insert_ids.join(",")
		]);
	const ids = artworks.map(artwork => artwork.id);
	// Load all associated records at once to reduce the amount of MySQL queries.
	const [imagesAll, keywordsAll] = await Promise.all([
		knex("image").whereIn("artwork", ids).orderBy("order", "asc"),
		knex("keyword").whereIn("artwork", ids)
	]);
	// Re-associate each image and keyword to their corresponding artwork objects.
	return artworks.map(artwork => {
		const images = imagesAll.filter(image => image.artwork == artwork.id);
		// Group keywords by type.
		const keywords = {};
		keywordsAll
			.filter(keyword => keyword.artwork == artwork.id)
			.forEach(row => {
				keywords[row.type] = keywords[row.type] || [];
				keywords[row.type].push(row.name);
			});
		const sender = {
			name: artwork.sender_name,
			birth_year: artwork.sender_birth_year,
			death_year: artwork.sender_death_year
		};
		const recipient = {
			name: artwork.recipient_name,
			birth_year: artwork.recipient_birth_year,
			death_year: artwork.recipient_death_year
		};
		const document = formatDocument({
			artwork,
			images,
			keywords,
			sender,
			recipient
		});
		if (includeInternalId) document._id = artwork.id;
		return document;
	});
}

/** Combine rows related to an object into a single structured object. */
function formatDocument({ artwork, images, keywords, sender, recipient }) {
	const imagesFormatted =
		images &&
		images.map(image => ({
			image: image.filename,
			imagesize: {
				width: image.width,
				height: image.height,
				type: image.type || undefined
			},
			page: {
				number: image.page,
				order: image.order,
				side: image.side,
				id: image.pageid || undefined
			},
			googleVisionColors: image.color
				? [
						{
							color: JSON.parse(image.color),
							score: 1
						}
				  ]
				: undefined
		}));
	return {
		insert_id: artwork.insert_id,
		id: artwork.insert_id,
		title: artwork.title,
		title_en: artwork.title_en,
		subtitle: artwork.subtitle,
		deleted: artwork.deleted,
		published: artwork.published,
		description: artwork.description,
		museum_int_id: artwork.museum_int_id.split("|"),
		collection: {
			museum: artwork.museum
		},
		museumLink: artwork.museum_url,
		item_date_str: artwork.date_human,
		item_date_string: artwork.date,
		size: artwork.size ? JSON.parse(artwork.size) : undefined,
		technique_material: artwork.technique_material,
		acquisition: artwork.acquisition,
		content: artwork.content,
		inscription: artwork.inscription,
		material: artwork.material,
		creator: artwork.creator,
		signature: artwork.signature,
		literature: artwork.literature,
		reproductions: artwork.reproductions,
		bundle: artwork.bundle,
		page: {
			order: artwork.bundle_order,
			side: artwork.bundle_side
		},
		images: imagesFormatted,
		image: imagesFormatted && imagesFormatted[0] && imagesFormatted[0].image,
		type: keywords.type,
		tags: keywords.tag,
		persons: keywords.person,
		places: keywords.place,
		genre: keywords.genre,
		exhibitions: artwork.exhibitions
			? JSON.parse(artwork.exhibitions).map(
					({ location, year }) => `${location}|${year}`
			  )
			: undefined,
		sender: sender
			? {
					name: sender.name,
					birth_year: sender.birth_year,
					death_year: sender.death_year
			  }
			: {},
		recipient: recipient
			? {
					name: recipient.name,
					birth_year: recipient.birth_year,
					death_year: recipient.death_year
			  }
			: {}
	};
}

async function deleteDocuments(insert_ids) {
	const ids = await knex("artwork")
		.pluck("id")
		.where("insert_id", "in", insert_ids);
	await Promise.all([
		knex("artwork").delete().where("id", "in", ids),
		knex("image").delete().where("artwork", "in", ids),
		knex("keyword").delete().where("artwork", "in", ids)
	]);
}

/**
 * Convert `undefined` values in an object to `null`.
 *
 * Useful when providing objects to knex.insert and knex.update.
 * Not recursive.
 */
function noUndefined(obj) {
	return _.mapObject(obj, v => (v === undefined ? null : v));
}

module.exports = {
	insertDocument,
	updateDocument,
	updateImages,
	loadDocuments,
	formatDocument,
	deleteDocuments
};
