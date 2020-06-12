const config = require("./config");
const knex = require("knex")({
	// debug: true,
	client: "mysql",
	connection: config.mysql
});

/** All the verbose code for storing and retreiving from MySQL and converting to/from artwork-centric document objects */

async function insertDocument(artwork) {
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
		exhibitions:
			artwork.exhibitions && artwork.exhibitions.length
				? JSON.stringify(
						artwork.exhibitions
							.filter(s => s)
							.map(s => {
								// "<location>|<year>" or "<location> <year>"
								const match = s.match(/(.*).(\d{4})/);
								return {
									location: match[1],
									year: match[2]
								};
							})
				  )
				: undefined,
		literature: artwork.literature,
		reproductions: artwork.reproductions,
		bundle: artwork.bundle
	};

	// Insert persons to reference them.
	for (const f of ["sender", "recipient"].filter(
		f => artwork[f] && (artwork[f].surname || artwork[f].name)
	)) {
		await knex("person")
			.insert({
				name: artwork[f].surname
					? `${artwork[f].firstname} ${artwork[f].surname}`
					: artwork[f].name,
				birth_year: artwork[f].birth_year,
				death_year: artwork[f].death_year
			})
			.catch(err => err.code === "ER_DUP_ENTRY" || Promise.reject(err))
			.then(insertIds => (values[f] = insertIds[0]));
	}

	await knex("artwork")
		.insert(values)
		.then(async insertIds => {
			const insertKeyword = (field, type) =>
				Promise.all(
					(Array.isArray(artwork[field]) ? artwork[field] : [artwork[field]])
						.filter(x => x)
						.map(name =>
							knex("keyword").insert({
								artwork: insertIds[0],
								type,
								name
							})
						)
				);
			await Promise.all([
				insertKeyword("type", "type"),
				insertKeyword("genre", "genre"),
				insertKeyword("tags", "tag"),
				insertKeyword("persons", "person"),
				insertKeyword("places", "place"),
				...artwork.images.map(image =>
					knex("image").insert({
						artwork: insertIds[0],
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
								image.googleVisionColors.sort((a, b) => b.score - a.score)[0]
									.color
							)
					})
				)
			]);
		});
}

/** Combine rows related to an object into a single structured object. */
function formatDocument({ artwork, images, keywords, sender, recipient }) {
	return {
		insert_id: artwork.insert_id,
		id: artwork.name,
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
		images:
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
			})),
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

module.exports = {
  insertDocument,
  formatDocument
};
