var express = require('express');
var bodyParser = require('body-parser');
var _ = require('underscore');
var elasticsearch = require('elasticsearch');
var IMGR = require('imgr').IMGR;
var request = require('request');
var fs = require('fs');
var path = require('path');

var config = require('./config');

var app = express();
var auth = require('basic-auth')
var busboy = require('connect-busboy');

var knex = require('knex')({
	client: 'mysql',
	// debug: true,
	connection: config.mysql,
})

var client = new elasticsearch.Client({
	host: config.es_host
//	log: 'trace'
});

function authenticate(user) {
	var users = require('./users').users;

	if (user) {
		var foundUser = _.find(users, function(u) {
			return u[0] == user['name'] && u[1] == user['pass'];
		});

		return foundUser !== undefined;
	}
	else {
		return false;
	}
}

app.use(busboy());

var auth = require('basic-auth');

// Check to see if requesting the /admin part of the API, if so, request authentication
app.use(function(req, res, next) {
	var user = auth(req);

	if (req.path.substr(0, 7).toLowerCase() != '/admin/') {
		next();
	}
	else if (user && authenticate(user)) {
		next();
	}
	else {
		res.setHeader('WWW-Authenticate', 'Basic realm="AroseniusAdminApi"');
		res.header('Access-Control-Allow-Origin', '*');
		res.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT')
		res.header('Access-Control-Allow-Headers', 'Authorization,Access-Control-Allow-Headers,Origin,Accept,X-Requested-With,Content-Type,Access-Control-Request-Method,Access-Control-Allow-Headers')
		res.end('Unauthorized');
	}
});

app.use(bodyParser.urlencoded({
	extended: false
}));

app.use(bodyParser.json({
	limit: '2mb'
}));

app.all('*', function(req, res, next) {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT')
	res.header('Access-Control-Allow-Headers', 'Authorization,Access-Control-Allow-Headers,Origin,Accept,X-Requested-With,Content-Type,Access-Control-Request-Method,Access-Control-Allow-Headers')
	next();
});

function adminLogin(req, res) {
	res.json({
		login: 'success'
	});
};

// Helper to build Elasticsearch queries
function QueryBuilder(req, sort, showUnpublished, showDeleted) {

	// Initialize the main body of the query
	if (sort && sort == 'insert_id') {
		// Sort by insert_id
		this.queryBody = {
			sort: [
				{
					'insert_id': {
						'order': 'asc'
					}
				}
			],
			query: {
				bool: {
					must: []
				}
			}
		};
	}
	else {
		// Automatically sort results to that artwork and photographs appear first in the list
		this.queryBody = {
			query: {
				function_score: {
					query: {
						bool: {
							must: []
						}
					},
					functions: [
						{
							filter: {
								term: {
									'genre.raw': 'Målning'
								}
							},
							weight: 3
						},
						{
							filter: {
								term: {
									'type.raw': 'Teckning'
								}
							},
							weight: 2
						},
						{
							filter: {
								term: {
									'type.raw': 'Skiss'
								}
							},
							weight: 1
						},
						{
							random_score: {
								seed: req.query.seed || (new Date()).toDateString()+(new Date()).getHours()+(Math.ceil(new Date().getMinutes()/20))
							}
						}
					],
					score_mode: 'sum'
				}
			}
		};
	}

	if (!showUnpublished) {
		this._queryObj().bool.must.push({
			'not': {
				'term': {
					'published': 'false'
				}
			}
		});
	}

	if (!showDeleted) {
		this._queryObj().bool.must.push({
			'not': {
				'term': {
					'deleted': 'true'
				}
			}
		});
	}
}

// Get reference to query object
QueryBuilder.prototype._queryObj = function() {
	return this.queryBody.query.function_score ? this.queryBody.query.function_score.query : this.queryBody.query;
}

// Function to add boolean query to the query body
QueryBuilder.prototype.addBool = function(terms, type, caseSensitive, nested, nestedPath, disableProcessing) {
	var boolObj = {
		bool: {}
	};

	boolObj.bool[type] = [];

	for (var i = 0; i<terms.length; i++) {
		if (disableProcessing) {
			boolObj.bool[type].push(terms[i]);
		}
		else {
			var propertyName = terms[i][2] ? terms[i][2] : 'term';
			var termObj = {};
			termObj[propertyName] = {}

			if (caseSensitive || propertyName != 'term' || terms[i][3]) {
				termObj[propertyName][terms[i][0]] = terms[i][1];
			}
			else {
				termObj[propertyName][terms[i][0]] = terms[i][1].toLowerCase();
			}

			boolObj.bool[type].push(termObj);
		}
	}

	if (nested) {
		this._queryObj().bool.must.push({
			nested: {
				path: nestedPath,
				query: boolObj
			}
		});
	}
	else {
		this._queryObj().bool.must.push(boolObj);
	}
}

/**
 * @api {get} /documents?params
 * @apiName GetDocuments
 * @apiGroup Documents
 * @apiDescription  Gets documents based on search params.
 * @apiVersion 1.0.0
 *
 * @apiParam insert_id {String} Get documents with insert_id creater than given value
 * @apiParam museum {String} Get documents from a specific museum
 * @apiParam bundle {String} Get documents in a specific bundle
 * @apiParam search {String} Get documents based on search strings. Searches in various fields listed below
 * @apiParam type {String} Get documents of specific type
 * @apiParam person {String} Get documents tagged with a specific person/persons
 * @apiParam tags {String} Get documents with a specific tag/tags
 * @apiParam place {String} Get documents tagged with a specific place/places
 * @apiParam genre {String} Get documents of specific genre
 * @apiParam year {String} Get documents of from specific year
 * @apiParam archivematerial {String} Defines if search should exclusively return artworks and photographs (only) or exclude artworks and photographs (exclude)
 *
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
      {
        "total": 1423,
        "documents": [
          {
            "type": [
             "Konstverk"
            ],
            "title": "Sittande pojke",
            "title_en": "",
            "size": {
              "inner": {
                "width": 30.5,
                "height": 38.8
              }
            },
            "collection": {
              "museum": "Göteborgs konstmuseum"
            }
          },
          [...]
        ],
        [...]
      }
 *
 */
function adminGetDocuments(req, res) {
	req.query.showUnpublished = true
	req.query.showDeleted = true
	getDocuments(req, res);
}

// Sort by insert_id (asc) if sort == 'insert_id',
// Otherwise sort by the sum of:
// - genre = Målning: 3
// - genre = Teckning: 2
// - genre = Skiss: 1
// - a random score (between 0 and 1?)
// showUnpublished and showDeleted default to false
// Params (AND) req.query[param]:
// - insert_id: require insert_id >=
// - museum
// - bundle
// - search: begins with, check various fields and related tables, see code
// - type
// - person: split by ';', use AND
// - tags: split by ';', use AND
// - place
// - genre
// - year
// - archivematerial: if 'only': require `type` neither 'fotografi' or 'konstverk'; if 'exclude': opposite
function createQuery(req, showUnpublished, showDeleted) {
	var queryBuilder = new QueryBuilder(req, req.query.sort, req.query.showUnpublished == 'true' || showUnpublished == true, req.query.showDeleted || showDeleted);

	// Get documents with insert_id creater than given value
	if (req.query.insert_id) {
		var range = {
			gte: req.query.insert_id
		};

		queryBuilder.addBool([
			['insert_id', range, 'range']
		], 'should', true);
	}

	// Get documents from a specific museum
	if (req.query.museum) {
		queryBuilder.addBool([
			['collection.museum.raw', req.query.museum]
		], 'should', true);
	}

	// Get documents in a specific bundle (deprected)
	if (req.query.bundle) {
		queryBuilder.addBool([
			['bundle', req.query.bundle]
		], 'should', true);
	}

	// Get documents based on search strings. Searches in various fields listed below
	if (req.query.search) {
		var terms = [];
		var textSearchTerm = {
			'query_string': {
				'query': req.query.search+'*',
				'fields': [
					'title^5',
					'description^5',
					'collection.museum',
					'places',
					'persons',
					'tags',
					'genre^10',
					'type^10',
					'museum_int_id',
					'material'
				],
				'minimum_should_match': '100%'
			}
		};

		queryBuilder.addBool([textSearchTerm], 'must', false, false, null, true);
	}

	// Get documents of specific type
	if (req.query.type) {
		queryBuilder.addBool([
			['type.raw', req.query.type]
		], 'should', true);
	}

	// Get documents tagged with a specific person/persons
	if (req.query.person) {
		var persons = req.query.person.split(';');

		_.each(persons, _.bind(function(person) {
			queryBuilder.addBool([
				['persons.raw', person]
			], 'should', true);
		}, this));
	}

	// Get documents with a specific tag/tags
	if (req.query.tags) {
		var tags = req.query.tags.split(';');

		_.each(tags, _.bind(function(tag) {
			queryBuilder.addBool([
				['tags.raw', tag]
			], 'should', true);
		}, this));
	}

	// Get documents tagged with a specific place/places
	if (req.query.place) {
		queryBuilder.addBool([
			['places.raw', req.query.place]
		], 'should', true);
	}

	// Get documents of specific genre
	if (req.query.genre) {
		queryBuilder.addBool([
			['genre.raw', req.query.genre]
		], 'should', true);
	}

	// Get documents of from specific year
	if (req.query.year) {
		queryBuilder.addBool([
			[{
				'range': {
					'item_date_string': {
						'gte': req.query.year+'||/y',
						'lte': req.query.year+'||/y',
						'format': 'yyyy'
					}
				}
			}]
		], 'must', false, false, null, true);

		//terms, type, caseSensitive, nested, nestedPath, disableProcessing
	}

	// Defines if search should exclusively return artworks and photographs (images) or exclude artworks and photographs
	if (req.query.archivematerial) {
		if (req.query.archivematerial == 'only') {
			queryBuilder.addBool([
				['type', 'fotografi'],
				['type', 'konstverk']
			], 'must_not', true);
		}
		if (req.query.archivematerial == 'exclude') {
			queryBuilder.addBool([
				['type', 'fotografi'],
				['type', 'konstverk']
			], 'should', true);
		}
	}

	return queryBuilder.queryBody;
}

/** Get the names of artworks matching a range of parameters. */
async function search(params) {
	const query = knex("artwork").distinct("artwork.name");

	// Ensure a table join for a keyword type.
	const keywordsJoined = [];
	const joinKeyword = (type) => {
		if (keywordsJoined.includes(type)) return;
		query.leftJoin(
			{ [`kw${type}`]: "keyword" },
			{
				[`kw${type}.type`]: knex.raw(`'${type}'`),
				[`kw${type}.artwork`]: "artwork.id"
			}
		)
		keywordsJoined.push(type)
	};

	// For other keyword types, join if necessary.
	const keywordTypes = ["type", "genre", "tag", "person", "place"];
	keywordTypes.forEach(keywordType => {
		if (params[keywordType]) {
			joinKeyword(keywordType);
			query.where(`kw${keywordType}.name`, params[keywordType]);
		}
	});
	if (!params.showUnpublished) {
		query.where("published", 1);
	}
	if (!params.showDeleted) {
		query.where("deleted", 0);
	}
	if (params.museum) {
		query.where("museum", "like", `${params.museum}%`);
	}
	if (params.bundle) {
		query.where("bundle", "like", `${params.bundle}%`);
	}
	if (params.year) {
		query.where(knex.raw("substring(date, 1, 4) = ?", [params.year]))
	}
	if (params.archivematerial) {
		// Join with the keyword table to find out if type has either Fotografi or Konstverk.
		query.leftJoin({ archive_keyword: "keyword" }, function () {
			this.on("archive_keyword.type", knex.raw("?", ["type"]))
				.on("archive_keyword.artwork", "artwork.id")
				.on(function () {
					this.on("archive_keyword.name", knex.raw("?", ["Fotografi"]));
					this.orOn("archive_keyword.name", knex.raw("?", ["Konstverk"]));
				});
		});
		if (params.archivematerial == "only") {
			// Require that both Fotografi and Konstverk are missing from type.
			query.whereNull("archive_keyword.id");
		} else if (params.archivematerial == "exclude") {
			// Require that type has either Fotografi and Konstverk.
			query.whereNotNull("archive_keyword.id");
		}
	}
	if (params.search) {
		// Boost fields differently.
		const colScores = {
			title: 0.5,
			description: 0.5,
			museum: 0.1,
			museum_int_id: 0.1,
			material: 0.1,
			"kwtype.name": 1.0,
			"kwgenre.name": 1.0,
			"kwtag.name": 0.1,
			"kwplace.name": 0.1,
			"kwperson.name": 0.1
		};

		// Build expressions for scoring by regexp.
		const searchExprs = Object.keys(colScores).map(col =>
			knex.raw("IF(?? REGEXP ?, ?, 0)", [
				col,
				`\\b${params.search}`,
				colScores[col]
			])
		);

		// Join all keyword types.
		keywordTypes.forEach(keywordType => {
			joinKeyword(keywordType);
		});

		// Group conditions with OR: require a match in at least one of the fields.
		query.where(function () {
			searchExprs.forEach(expr => this.orWhere(expr, ">", 0));
		});

		// Sum up the score for sorting.
		// Unfortunately, this alias cannot be re-used in the where-clause above, so the query gets very long.
		query.select({
			search_score: knex.raw(
				searchExprs.map(() => "?").join(" + "),
				searchExprs
			)
		});
	} else {
		query.select({ search_score: 0 });
	}
	
	// Determine sorting.
	if (params.sort === "insert_id") {
		query.orderBy("insert_id", "asc");
	} else {
		const sortGenres = ["Målning", "Teckning", "Skiss"];
		// Join the keyword table (again) specifically to find out whether these keywords are present.
		sortGenres.forEach((genre, i) =>
			query.leftJoin(
				{ [`sort${i}`]: "keyword" },
				{
					[`sort${i}.type`]: knex.raw("?", ["genre"]),
					[`sort${i}.artwork`]: "artwork.id",
					[`sort${i}.name`]: knex.raw("?", [genre])
				}
			)
		);
		query.select({
			sort_score: knex.raw(
				sortGenres
					.map((_, i) => `IF(sort${i}.id, ${sortGenres.length - i}, 0)`)
					.join(" + ")
			)
		});
		// The random factor "smudges out" the boundaries between sections.
		query.orderBy(
			knex.raw(`sort_score + search_score + RAND(NOW() DIV 2000) * 1.1`),
			"desc"
		);
	}

	return query.then(rows => rows.map(row => row.name));
}

function aggsUnique(field, additional = {}) {
	return {
		"size": 0,
		"aggs": {
			"uniq": {
				// Exclude deleted artworks.
				"filter": {
					"bool": {
						"must_not": {
							"term": {
								"deleted": true
							}
						}
					}
				},
				"aggs": {
					"uniq": {
						"terms": Object.assign({
							"field": field,
							"size": 5000,
						}, additional)
					}
				}
			}
		}
	};
}

function getNextId(req, res) {
	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		size: 1,
		body: {
			sort: [
				{
					"insert_id": {
						"order": "asc"
					}
				}
			],
			"query": {
				"bool": {
					"must": [
						{
							"range": {
								"insert_id": {
									"gte": Number(req.params.insert_id)+1
								}
							}
						}
					]
				}
			}
		}
	}, function(error, response) {
		console.log(error)
	
		try {
			res.json({
				id: response.hits.hits[0]._id,
				title: response.hits.hits[0]._source.title,
				insert_id: response.hits.hits[0]._source.insert_id
			});
		}
		catch (e) {
			res.json({error: 'not found'});
		}
	});
}

function getPrevId(req, res) {
	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		size: 1,
		body: {
			sort: [
				{
					"insert_id": {
						"order": "desc"
					}
				}
			],
			"query": {
				"bool": {
					"must": [
						{
							"range": {
								"insert_id": {
									"lte": Number(req.params.insert_id)-1
								}
							}
						}
					]
				}
			}
		}
	}, function(error, response) {
		console.log(error)
	
		try {
			res.json({
				id: response.hits.hits[0]._id,
				title: response.hits.hits[0]._source.title,
				insert_id: response.hits.hits[0]._source.insert_id
			});
		}
		catch (e) {
			res.json({error: 'not found'});
		}
	});
}

function getHighestId(req, res) {
	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		size: 0,
		body: {
			"aggs": {
				"insert_id": {
					"max": {
						"field": "insert_id"
					}
				}
			}
		}
	}, function(error, response) {
		console.log(error)
	
		try {
			res.json({
				highest_insert_id: response.aggregations.insert_id.value
			});
		}
		catch (e) {
			res.json({error: 'not found'});
		}
	});
}

// Search for documents
function getDocuments(req, res) {
	if (req.query.ids) {
		// Get specific documents.
		loadDocuments(req.query.ids.split(";")).then(docs =>
			res.json({
				data: docs.length ? docs.map(formatDocument) : undefined
			})
		);
	} else {
		// Perform search.
		search(req.query).then(names => {
			const size = req.query.showAll ? 10000 : req.query.count || 100;
			const from =
				!req.query.showAll && req.query.page > 0
					? (req.query.page - 1) * size
					: 0;
			loadDocuments(names.slice(from, from + size)).then(docs =>
				res.json({
					total: names.length,
					documents: docs.map(doc => {
						if (req.query.simple) doc.images = undefined;
						return formatDocument(doc);
					})
				})
			)
		});
	}
}

function putCombineDocuments(req, res) {
	var ids = req.body.documents;
	var finalDocument = req.body.selectedDocument;

	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		size: 100,
		body: {
			query: {
				query_string: {
					query: '_id: '+ids.join(' OR _id: ')
				}
			}
		}
	}, function(error, response) {
		if (ids.length != response.hits.total) {
			res.status(500);
			res.json({error: 'Unable to combine documents, have they been combined before?'});
		}
		else {

			var imageMetadataArray = [];

			_.each(response.hits.hits, function(document) {
				var imageMetadata = {};

				if (document._source.image) {
					imageMetadata.image = document._source.image;

					if (document._source.page) {
						imageMetadata.page = document._source.page;
					}
					if (document._source.imagesize) {
						imageMetadata.imagesize = document._source.imagesize;
					}

					imageMetadataArray.push(imageMetadata);
				}

				if (document._source.images) {
					imageMetadataArray = imageMetadataArray.concat(document._source.images);
				}

				imageMetadataArray = _.uniq(imageMetadataArray, function(image) {
					return image.image;
				});
			});

			imageMetadataArray = _.sortBy(imageMetadataArray, function(image) {
				return image.page.order || 0;
			});

			throw new Error("Not implemented in MySQL yet.");
			client.update({
				index: config.index,
				type: 'artwork',
				id: finalDocument,
				body: {
					doc: {
						images: imageMetadataArray,
					}
				}
			}, function(error, response) {
				var documentsToDelete = _.difference(ids, [finalDocument]);

				var bulkBody = _.map(documentsToDelete, function(document) {
					return {
						delete: {
							_index: config.index,
							_type: 'artwork',
							_id: document
						}
					}
				});

				throw new Error("Not implemented in MySQL yet.");
				client.bulk({
					body: bulkBody
				}, function(error, response) {
					res.json({response: 'post'});
				});
			});
		}
	});
}

function putDocument(req, res) {
	var document = req.body;

	if (document.images && document.images.length > 0) {
		document.images = processImages(document.images);
	}

	throw new Error("Not implemented in MySQL yet.");
	client.create({
		index: config.index,
		type: 'artwork',
		id: req.body.id,
		body: document
	}, function(error, response) {
		res.json(response);
	});
}

var sizeOf = require('image-size');

function processImages(images) {
	images = _.sortBy(images, function(image) {
		return image.page && Number(image.page.order) || 0;
	});

	images = images.map(function(image) {
		image.imagesize = sizeOf(config.image_path+'/'+image.image+'.jpg')
		return image;
	});

	return images;
}

function postDocument(req, res) {
	var document = req.body;

	if (document.images && document.images.length > 0) {
		document.images = processImages(document.images);
	}

	throw new Error("Not implemented in MySQL yet.");
	client.update({
		index: config.index,
		type: 'artwork',
		id: req.body.id,
		body: {
			doc: document
		}
	}, function(error, response) {
		res.json({response: 'post'});
	});
}

/**
 * @api {get} /document/:id
 * @apiName GetDocument
 * @apiGroup Document
 * @apiDescription  Get single document.
 * @apiVersion 1.0.0
 *
 * @apiParam {String} id document id
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
      {
        "data": {
          "type": [
           "Konstverk"
          ],
          "title": "Sittande pojke",
          "title_en": "",
          "size": {
            "inner": {
              "width": 30.5,
              "height": 38.8
            }
          },
          "collection": {
            "museum": "Göteborgs konstmuseum"
          },
          [...]
        }
      }
 *
 */
function getDocument(req, res) {
	var query = [];
	if (req.query.museum) {
		query.push('collection.museum: "'+req.query.museum+'"');
	}
	
	loadDocuments([req.params.id]).then(docs => res.json({
		data: docs.length ? formatDocument(docs[0]) : undefined
	}))
}

/** Load a document from the database and format it. */
async function loadDocuments(ids) {
	const results = await knex("artwork").where("name", "in", ids);
	const documents = [];
	for (const artwork of results) {
		// No point in making queries in parallel because MySQL is sequential.
		const images = await knex("image").where("artwork", artwork.id);
		const keywords = await knex("keyword").where("artwork", artwork.id);
		// Group keywords by type.
		const keywordsByType = {};
		keywords.forEach(row => {
			keywordsByType[row.type] = keywordsByType[row.type] || [];
			keywordsByType[row.type].push(row.name);
		});
		const exhibitions = await knex("exhibition").where("artwork", artwork.id);
		const sender =
			artwork.sender && (await knex("person").where("id", artwork.sender));
		const recipient =
			artwork.recipient &&
			(await knex("person").where("id", artwork.recipient));
		documents.push({
			artwork,
			images,
			keywords: keywordsByType,
			exhibitions,
			sender,
			recipient
		});
	}
	return documents;
}

/** Combine rows related to an object into a single structured object. */
function formatDocument({ artwork, images, keywords, exhibitions, sender, recipient }) {
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
		size: artwork.size && JSON.parse(artwork.size),
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
		images: images && images.map(image => ({
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
			googleVisionColors: image.color ? [{
				color: JSON.parse(image.color),
				score: 1,
			}] : undefined,
		})),
		type: keywords.type,
		tags: keywords.tag,
		persons: keywords.person,
		places: keywords.place,
		genre: keywords.genre,
		exhibitions: exhibitions.length ? exhibitions.map(({ location, year }) => `${location}|${year}`) : undefined,
		sender: sender ? { name: sender.name, birth_year: sender.birth_year, death_year: sender.death_year } : {},
		recipient: recipient ? { name: recipient.name, birth_year: recipient.birth_year, death_year: recipient.death_year } : {},
	};
}

function getMuseums(req, res) {
	knex("artwork")
		.select("museum")
		.whereNot("deleted", 1)
		.whereNot("museum", "")
		.groupBy("museum")
		.orderByRaw("count(id) desc")
		.then(rows => res.json(rows.map(row => ({ value: row.museum }))));
}

/** Build SQL query for listing the keywords of a given type. */
function keywordList(req, res, type) {
	return knex("keyword")
		.select("keyword.name")
		.count({ count: "keyword.id" })
		.join("artwork", "keyword.artwork", "=", "artwork.id")
		.where("keyword.type", type)
		.whereNot("artwork.deleted", 1)
		.groupBy("keyword.name")
		.orderBy([
			req.query.sort === "doc_count"
				? { column: "count", order: "desc" }
				: { column: "keyword.name", order: "asc" }
		])
		.then(rows =>
			res.json(rows.map(row => ({ value: row.name, doc_count: row.count })))
		);
}

function getTypes(req, res) {
	keywordList(req, res, "type");
}

function getTags(req, res) {
	keywordList(req, res, "tag");
}

function getPersons(req, res) {
	keywordList(req, res, "person");
}

function getPlaces(req, res) {
	keywordList(req, res, "place");
}

function getGenres(req, res) {
	keywordList(req, res, "genre");
}

function getTagCloud(req, res) {
	var additional = !req.query.sort || req.query.sort != 'doc_count' ? { order: { _term: 'asc' } } : {}
	// Only use aggsUnique to get the base, then replace `temp` with specific term aggs.
	var queryBody = aggsUnique('temp', additional)
	queryBody.aggs.uniq.aggs = {
		"tags": {
			"terms": {
				"field": "tags.raw",
				"size": 5000,
				"exclude": "GKMs diabildssamling|Skepplandamaterialet"
			}
		},
		"persons": {
			"terms": {
				"field": "persons.raw",
				"size": 5000
			}
		},
		"places": {
			"terms": {
				"field": "places.raw",
				"size": 5000
			}
		},
		"genre": {
			"terms": {
				"field": "genre.raw",
				"size": 5000
			}
		},
		"collections": {
			"terms": {
				"field": "collection.museum.raw",
				"size": 5000
			}
		}
	};

	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		body: queryBody
	}, function(error, response) {
		res.json(_.filter(_.map(response.aggregations.tags.buckets, function(tag) {
				return {
					value: tag.key,
					doc_count: tag.doc_count,
					type: 'tags'
				};
			})
			.concat(_.map(response.aggregations.persons.buckets, function(tag) {
				return {
					value: tag.key,
					doc_count: tag.doc_count,
					type: 'person'
				};
			}))
			.concat(_.map(response.aggregations.places.buckets, function(tag) {
				return {
					value: tag.key,
					doc_count: tag.doc_count,
					type: 'place'
				};
			}))
			.concat(_.map(response.aggregations.collections.buckets, function(tag) {
				return {
					value: tag.key,
					doc_count: tag.doc_count,
					type: 'museum'
				};
			}))
			.concat(_.map(response.aggregations.genre.buckets, function(tag) {
				return {
					value: tag.key,
					doc_count: tag.doc_count,
					type: 'genre'
				};
			})), function(tag) {
			return tag.doc_count > 4;
		}));
	});
}

function getPagetypes(req, res) {
	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		body: aggsUnique('page.side')
	}, function(error, response) {
		res.json(_.map(response.aggregations.uniq.uniq.buckets, function(side) {
			return {
				value: side.key
			};
		}));
	});
}

function getExhibitions(req, res) {
	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		body: aggsUnique('exhibitions.raw', {size: 200, order: {_term: 'asc'}})
	}, function(error, response) {
		res.json(_.map(response.aggregations.uniq.uniq.buckets, function(genre) {
			return {
				value: genre.key
			};
		}));
	});
}

function getYearRange(req, res) {
	var query = createQuery(req);

	if (query.sort) {
		delete query.sort;
	}

	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			size: 0,
			query: query,
			aggs: {
				years: {
					date_histogram: {
						field: "item_date_string",
						interval: "1y",
						time_zone: "Europe/Berlin",
						min_doc_count: 1
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.years.buckets, function(bucket) {
			return {
				year: bucket.key_as_string.split('-')[0],
				key: bucket.key,
				doc_count: bucket.doc_count
			};
		}));
	});
}

function getAutoComplete(req, res) {
	var searchStrings = req.query.search.toLowerCase().split(' ');

	var query = [
		// Documents
		{ index: config.index, type: 'artwork' },
		{
			size: 10,
			query: {
				bool: {
					must: _.map(searchStrings, function(searchString) {
						return {
							wildcard: {
								title: '*'+searchString+'*'
							}
						}
					})
				}
			}
		},

		// Titles aggregation
		{ index: config.index, type: 'artwork' },
		{
			size: 0,
			query: {
				bool: {
					must: _.map(searchStrings, function(searchString) {
						return {
							wildcard: {
								title: '*'+searchString+'*'
							}
						}
					})
				}
			},
			aggs: {
				titles: {
					terms: {
						field: 'title.raw',
						size: 100,
						order: {
							_term: 'asc'
						}
					}
				}
			}
		},

		// Tags
		{ index: config.index, type: 'artwork' },
		{
			size: 0,
			query: {
				bool: {
					must: _.map(searchStrings, function(searchString) {
						return {
							wildcard: {
								tags: '*'+searchString+'*'
							}
						}
					})
				}
			},
			aggs: {
				tags: {
					terms: {
						field: 'tags.raw',
						size: 100,
						order: {
							_term: 'asc'
						}
					}
				}
			}
		},

		// Places
		{ index: config.index, type: 'artwork' },
		{
			size: 0,
			query: {
				bool: {
					must: _.map(searchStrings, function(searchString) {
						return {
							wildcard: {
								places: '*'+searchString+'*'
							}
						}
					})
				}
			},
			aggs: {
				places: {
					terms: {
						field: 'places.raw',
						size: 100,
						order: {
							_term: 'asc'
						}
					}
				}
			}
		},

		// Persons
		{ index: config.index, type: 'artwork' },
		{
			size: 0,
			query: {
				bool: {
					must: _.map(searchStrings, function(searchString) {
						return {
							wildcard: {
								persons: '*'+searchString+'*'
							}
						}
					})
				}
			},
			aggs: {
				persons: {
					terms: {
						field: 'persons.raw',
						size: 100,
						order: {
							_term: 'asc'
						}
					}
				}
			}
		},

		// Genre
		{ index: config.index, type: 'artwork' },
		{
			size: 0,
			query: {
				bool: {
					must: _.map(searchStrings, function(searchString) {
						return {
							wildcard: {
								genre: '*'+searchString+'*'
							}
						}
					})
				}
			},
			aggs: {
				genre: {
					terms: {
						field: 'genre.raw',
						size: 100,
						order: {
							_term: 'asc'
						}
					}
				}
			}
		},

		// Type
		{ index: config.index, type: 'artwork' },
		{
			size: 0,
			query: {
				bool: {
					must: _.map(searchStrings, function(searchString) {
						return {
							wildcard: {
								type: '*'+searchString+'*'
							}
						}
					})
				}
			},
			aggs: {
				type: {
					terms: {
						field: 'type.raw',
						size: 100,
						order: {
							_term: 'asc'
						}
					}
				}
			}
		},

		// Museum
		{ index: config.index, type: 'artwork' },
		{
			size: 0,
			query: {
				bool: {
					must: _.map(searchStrings, function(searchString) {
						return {
							wildcard: {
								'collection.museum': '*'+searchString+'*'
							}
						}
					})
				}
			},
			aggs: {
				museum: {
					terms: {
						field: 'collection.museum.raw',
						size: 100,
						order: {
							_term: 'asc'
						}
					}
				}
			}
		}
	];

	throw new Error("Not implemented in MySQL yet.");
	client.msearch({
		body: query
	}, function(error, response) {
		var getBuckets = function(field) {
			var responseItem = _.find(response.responses, function(item) {
				return Boolean(item.aggregations && item.aggregations[field]);
			});

			var buckets = _.filter(responseItem.aggregations[field].buckets, function(item) {
				var found = false;

				_.each(searchStrings, function(searchString) {
					if (item.key.toLowerCase().indexOf(searchString) > -1) {
						found = true;
					}
				})
				return found;
			});

			return buckets;
		};

		var results = {

			documents: _.map(response.responses[0].hits.hits, function(item) {
				return {
					key: item._source.title,
					id: item._id
				}
			}),
			titles: getBuckets('titles'),
			tags: getBuckets('tags'),
			persons: getBuckets('persons'),
			places: getBuckets('places'),
			genre: getBuckets('genre'),
			type: getBuckets('type'),
			museum: getBuckets('museum')
		};


		res.json(results);
	});
}

function getImageFileList(req, res) {
	fs.readdir(config.image_path, function(err, files) {
		var fileList = [];
		files.forEach(function(file) {
			if (!fs.lstatSync(path.join(config.image_path, file)).isDirectory()) {
				fileList.push({
					file: file
				});
			}
		});

		res.json(fileList);
	})
}

function postImageUpload(req, res) {
	var fstream;
	req.pipe(req.busboy);
	req.busboy.on('file', function (fieldname, file, filename) {
		fstream = fs.createWriteStream(config.image_path+'/'+filename);
		file.pipe(fstream);
		fstream.on('close', function () {    
			res.json({
				success: 'file uploaded',
				filename: filename
			});
		});
	});
}

var imgr = new IMGR({
	cache_dir: config.image_temp_path
});

imgr.serve(config.image_path)
	.namespace('/images')
	.urlRewrite('/:path/:size/:file.:ext')
	.using(app);

const urlRoot = config.urlRoot;

app.use(express.static(__dirname + '/documentation'));

app.get(urlRoot+'/documents', getDocuments);
app.get(urlRoot+'/document/:id', getDocument);
app.get(urlRoot+'/museums', getMuseums);
app.get(urlRoot+'/types', getTypes);
app.get(urlRoot+'/tags', getTags);
app.get(urlRoot+'/tags/cloud', getTagCloud);
app.get(urlRoot+'/pagetypes', getPagetypes);
app.get(urlRoot+'/persons', getPersons);
app.get(urlRoot+'/places', getPlaces);
app.get(urlRoot+'/genres', getGenres);
app.get(urlRoot+'/exhibitions', getExhibitions);

app.get(urlRoot+'/next/:insert_id', getNextId);
app.get(urlRoot+'/prev/:insert_id', getPrevId);
app.get(urlRoot+'/highest_insert_id', getHighestId);

app.get(urlRoot+'/autocomplete', getAutoComplete);

app.get(urlRoot+'/year_range', getYearRange);

app.get(urlRoot+'/admin/login', adminLogin);
app.put(urlRoot+'/admin/documents/combine', putCombineDocuments);
app.get(urlRoot+'/admin/documents', adminGetDocuments);
app.put('/admin/document/:id', putDocument);
app.post('/admin/document/:id', postDocument);
app.get('/admin/document/:id', getDocument);
app.get('/admin/museums', getMuseums);
app.get('/image_file_list', getImageFileList);
app.post('/admin/upload', postImageUpload);

app.listen(config.port || 3010, function () {
  console.log('Arosenius project API');
});
