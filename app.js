var express = require('express');
var bodyParser = require('body-parser');
var _ = require('underscore');
var elasticsearch = require('elasticsearch');
var mysql = require('mysql');
var IMGR = require('imgr').IMGR;
var request = require('request');
var fs = require('fs');
var path = require('path');

var config = require('./config');

var app = express();
var auth = require('basic-auth')
var busboy = require('connect-busboy');

var client = new elasticsearch.Client({
	host: config.es_host
//	log: 'trace'
});

const sql = mysql.createConnection({ ...config.mysql });

// Wrap sql.query as a promise
function sqlQuery(query, values) {
  return new Promise((resolve, reject) =>
    sql.query(query, values, (error, results) =>
      error ? reject(error) : resolve(results)
    )
  );
}

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
	getDocuments(req, res, true, true);
}

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

	if (req.query.google_label) {
		var persons = req.query.google_label.split(';');

		_.each(persons, _.bind(function(google_label) {
			// terms, type, caseSensitive, nested, nestedPath, disableProcessing
//		queryBuilder.addBool(terms, 'must', false, true, colorPath);

			queryBuilder.addBool([
				['googleVisionLabels.label', google_label]
			], 'must', false, true, 'googleVisionLabels');
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

	// Get documents of specific color - rewrite needed
	if (req.query.hue || req.query.saturation || req.query.lightness) {
		var colorMargins = 15;
		var colorPath = 'googleVisionColors';

		var terms = [];

		if (req.query.hue) {
			terms.push([
				colorPath+'.hsv.h',
				{
					from: Number(req.query.hue)-colorMargins,
					to: Number(req.query.hue)+colorMargins
				},
				'range'
			]);
		}
		if (req.query.saturation) {
			terms.push([
				colorPath+'.hsv.s',
				{
					from: Number(req.query.saturation)-colorMargins,
					to: Number(req.query.saturation)+colorMargins
				},
				'range'
			]);
		}
		if (req.query.lightness) {
			terms.push([
				colorPath+'.hsv.v',
				{
					from: Number(req.query.lightness)-colorMargins,
					to: Number(req.query.lightness)+colorMargins
				},
				'range'
			]);
		}

		terms.push([
			colorPath+'.score',
			{
				from: 0.2,
				to: 1
			},
			'range'
		]);

		queryBuilder.addBool(terms, 'must', false, true, colorPath);
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
function getDocuments(req, res, showUnpublished = false, showDeleted = false) {
	var pageSize = req.query.count || 100;

	var query = {};

	if (req.query.ids) {
		// Do a mget query
		var docIds = req.query.ids.split(';');
		query = {
			ids: docIds
		};

		throw new Error("Not implemented in MySQL yet.");
		client.mget({
			index: config.index,
			type: 'artwork',
			body: query
		}, function(error, response) {
			res.json({
				query: req.query.showQuery == 'true' ? query : null,
				documents: response.docs ? _.compact(_.map(response.docs, function(item) {
					if (item._source) {
						var ret = item._source;
						ret.id = item._id;

						if (ret.images && ret.images.length > 0) {
							_.each(ret.images, function(image) {
								if (image.color && image.color.colors) {
									delete image.color.colors;
								}
							})
						}

						return ret;
					}
				})) : []
			});
		});
	}
	else {
		query = createQuery(req, showUnpublished, showDeleted);

		// Send the search query to Elasticsearch
		throw new Error("Not implemented in MySQL yet.");
		client.search({
			index: config.index,
			type: 'artwork',
			// pagination
			size: req.query.showAll && req.query.showAll == 'true' ? 10000 : pageSize,
			from: req.query.showAll && req.query.showAll == 'true' ? 0 : (req.query.page && req.query.page > 0 ? (req.query.page-1)*pageSize : 0),
			body: req.query.ids ? query : query
		}, function(error, response) {
			res.json({
				query: req.query.showQuery == 'true' ? query : null,
				total: response.hits ? response.hits.total : 0,
				documents: response.hits ? _.map(response.hits.hits, function(item) {
					var ret = item._source;
					ret.id = item._id;

					if (ret.images && ret.images.length > 0) {
						_.each(ret.images, function(image) {
							if (image.color && image.color.colors) {
								delete image.color;
							}
							if (image.googleVisionLabels) {
								delete image.googleVisionLabels;
							}
						})
					}

					if (ret.googleVisionLabels) {
						delete ret.googleVisionLabels;
					}
					if (ret.googleVisionColors) {
						delete ret.googleVisionColors;
					}

					if (req.query.simple) {
						delete ret.images;
					}

					return ret;
				}) : []
			});
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
					if (document._source.color) {
						imageMetadata.color = document._source.color;
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
						color: null
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
	
	loadDocuments([req.params.id, 'foo']).then(docs => res.json({
		data: docs.length ? formatDocument(docs[0]) : undefined
	}))
}

/** Load a document from the database and format it. */
async function loadDocuments(ids) {
  const results = await sqlQuery(
    "SELECT * FROM artwork WHERE name IN (?) LIMIT 1",
    [ids]
  );
  const documents = [];
  for (const artwork of results) {
    // No point in making queries in parallel because MySQL is sequential.
    const images = await sqlQuery(
      "SELECT * FROM image WHERE artwork = ?",
      artwork.id
    );
    const keywords = await sqlQuery(
      "SELECT * FROM keyword WHERE artwork = ?",
      artwork.id
		)
		// Group keywords by type.
		const keywordsByType = {}
		keywords.forEach(row => {
			keywordsByType[row.type] = keywordsByType[row.type] || []
			keywordsByType[row.type].push(row.name)
		})
    const exhibitions = await sqlQuery(
      "SELECT * FROM exhibition WHERE artwork = ?",
      artwork.id
    );
    const sender =
      artwork.sender &&
      (await sqlQuery("SELECT * FROM person WHERE id = ?", artwork.sender));
    const recipient =
      artwork.recipient &&
      (await sqlQuery("SELECT * FROM person WHERE id = ?", artwork.recipient));
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
    images: images.map(image => ({
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
      }
    })),
    type: keywords.type,
    tags: keywords.tag,
    persons: keywords.person,
    places: keywords.place,
    genre: keywords.genre,
    exhibitions: exhibitions.length ? exhibitions.map(({ location, year }) => `${location}|${year}`) : undefined,
    sender: { ...sender },
    recipient: { ...recipient }
  };
}

function getMuseums(req, res) {
  sql.query(
    "SELECT museum FROM artwork WHERE NOT deleted AND museum <> '' GROUP BY museum ORDER BY COUNT(id) DESC",
    (err, results) => res.json(results.map(row => ({ value: row.museum })))
  );
}

/** Build SQL query for listing the keywords of a given type. */
function keywordListQuery(req, type) {
	return `SELECT keyword.name, count(keyword.id) as count FROM keyword
    JOIN artwork ON keyword.artwork = artwork.id
    WHERE NOT artwork.deleted AND keyword.type = "${type}"
    GROUP BY keyword.name ORDER BY
		${req.query.sort === "doc_count" ? "count DESC" : "keyword.name ASC"}`;
}

function getTypes(req, res) {
	sql.query(keywordListQuery(req, "type"), (err, results) =>
    res.json(results.map(row => ({ value: row.name, doc_count: row.count })))
  );
}

function getTags(req, res) {
	sql.query(keywordListQuery(req, "tag"), (err, results) =>
    res.json(results.map(row => ({ value: row.name, doc_count: row.count })))
  );
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
                                        type: 'collection'
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

function getPersons(req, res) {
	sql.query(keywordListQuery(req, "person"), (err, results) =>
    res.json(results.map(row => ({ value: row.name, doc_count: row.count })))
  );
}

function getPlaces(req, res) {
  sql.query(keywordListQuery(req, "place"), (err, results) =>
    res.json(results.map(row => ({ value: row.name, doc_count: row.count })))
  );
}

function getGenres(req, res) {
  sql.query(keywordListQuery(req, "genre"), (err, results) =>
    res.json(results.map(row => ({ value: row.name, doc_count: row.count })))
  );
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

function getGoogleVisionLabels(req, res) {
	var query = createQuery(req);

	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			query: query.query,
			size: 0,
			aggs: {
				googleVison: {
					nested: {
						path: "googleVisionLabels"
					},
					aggs: {
						labels: {
							terms: {
								field: "googleVisionLabels.label",
								size: 1000,
								exclude: "font|paper|text|document|art|artwork|drawing|illustration|visual arts|material|handwriting|writing|paper product|painting|black and white|sketch|letter|picture frame|calligraphy|portrait|history|photograph|angle|figure drawing|stock photography|vintage clothing|line|snapshot|paint|watercolor paint|monochrome"
							}
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.googleVison.labels.buckets, function(label) {
			return {
				value: label.key,
				doc_count: label.doc_count
			}
		}));
	});
}

function getColorMap(req, res) {
	var nestedPath = 'googleVisionColors';
	var query = createQuery(req);

	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			size: 0,
			query: query,
			aggs: {
				colormap: {
					nested: {
						path: nestedPath
					},
					aggs: {
						filtered: {
							filter: {
								range: {
									"googleVisionColors.score": {
										gte: 0.2,
										lte: 1
									}
								}
							},
							aggs: {
								hue: {
									terms: {
										field: nestedPath+'.hsv.h',
										size: 360,
										order: {
											_term: 'asc'
										}
									},
									aggs: {
										saturation: {
											terms: {
												field: nestedPath+'.hsv.s',
												size: 100,
												order: {
													_term: 'asc'
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.colormap.filtered.hue.buckets, function(hue) {
			return {
				hue: hue.key,
				saturation: _.map(hue.saturation.buckets, function(saturation) {
					return saturation.key;
				})
			};
		}));

	});
}

function getColorMatrix(req, res) {
	var nestedPath = req.query.prominent == 'true' ? 'color.colors.prominent' : 'color.colors.three';

	throw new Error("Not implemented in MySQL yet.");
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			size: 0,
			query: {
				query_string: {
					query: req.query.query ? req.query.query : '*',
					analyze_wildcard: true
				}
			},

			aggs: {
				hue: {
					nested: {
						path: nestedPath
					},
					aggs: {
						hue: {
							terms: {
								field: nestedPath+'.hsv.h',
								size: 360,
								order: {
									_term: 'asc'
								}
							},
							aggs: {
								saturation: {
									terms: {
										field: nestedPath+'.hsv.s',
										size: 100,
										order: {
											_term: 'asc'
										}
									},
									aggs: {
										lightness: {
											terms: {
												field: nestedPath+'.hsv.v',
												size: 100,
												order: {
													_term: 'asc'
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}

		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.hue.hue.buckets, function(hue) {
			return {
				hue: hue.key,
				saturation: _.map(hue.saturation.buckets, function(saturation) {
					return {
						saturation: saturation.key,
						lightness: _.map(saturation.lightness.buckets, function(lightnessObj) {
							return {
								lightness: lightnessObj.key
							}
						})
					};
				})
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
// uses googleVisionColors
app.get(urlRoot+'/colormap', getColorMap);
// only api call that uses color.colors.prominent, also uses color.colors.three
app.get(urlRoot+'/colormatrix', getColorMatrix);

app.get(urlRoot+'/next/:insert_id', getNextId);
app.get(urlRoot+'/prev/:insert_id', getPrevId);
app.get(urlRoot+'/highest_insert_id', getHighestId);

// Only used by GoogleVisionLabelsViewer component in frontend which is just a demo
app.get(urlRoot+'/googleVisionLabels', getGoogleVisionLabels);

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
