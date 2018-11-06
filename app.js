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
									'type.raw': 'Konstverk'
								}
							},
							weight: 2
						},
						{
							filter: {
								term: {
									'type.raw': 'fotografi'
								}
							},
							weight: 1
						},
						{
							random_score: {
								seed: req.query.seed || (new Date()).toDateString()+(new Date()).getHours()+(new Date().getMinutes())
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
 * @apiParam bundle {String} Get documents in a specific bundle (deprected)
 * @apiParam search {String} Get documents based on search strings. Searches in various fields listed below
 * @apiParam type {String} Get documents of specific type
 * @apiParam letter_from {String} Get documents based on name of a sender (applies for letters)
 * @apiParam letter_to {String} Get documents based on name of a receiver (applies for letters)
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

	// Get documents based on name of a sender (applies for letters)
	if (req.query.letter_from) {
		queryBuilder.addBool([
			['sender.name', req.query.letter_from]
		], 'should');
	}

	// Get documents based on name of a receiver (applies for letters)
	if (req.query.letter_to) {
		queryBuilder.addBool([
			['sender.recipient', req.query.letter_to]
		], 'should');
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

function getNextId(req, res) {
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
	var colorMargins = req.query.color_margins ? Number(req.query.color_margins) : 15;
	var pageSize = req.query.count || 100;

	var query = {};

	if (req.query.ids) {
		// Do a mget query
		var docIds = req.query.ids.split(';');
		query = {
			ids: docIds
		};

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
								delete image.color.colors;
							}
						})
					}

					return ret;
				}) : []
			});
		});
	}
}

// Deprecated
function getBundle(req, res) {
	var pageSize = 30;

	var query = [];

	query.push('bundle: "'+req.params.bundle+'"');

	client.search({
		index: config.index,
		type: 'bundle',
		q: 'bundle: "'+req.params.bundle+'"'
	}, function(error, response) {
		res.json({
			data: response.hits.hits[0]._source
		});
	});

}

function putCombineDocuments(req, res) {
	var ids = req.body.documents;
	var finalDocument = req.body.selectedDocument;

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

				client.bulk({
					body: bulkBody
				}, function(error, response) {
					res.json({response: 'post'});
				});
			});
		}
	});
}

function putBundle(req, res) {
	var documents = req.body.documents;
	delete req.body.documents;

	if (documents.length > 0) {
		client.create({
			index: config.index,
			type: 'bundle',
			body: req.body
		}, function(error, response) {
			if (response && response._id) {
				var newId = response._id;

				var bulkBody = [
					{
						update: {
							_index: config.index,
							_type: 'bundle',
							_id: newId
						}
					},
					{
						doc: {
							bundle: newId
						}
					}
				];

				_.each(documents, function(document) {
					bulkBody.push({
						update: {
							_index: config.index,
							_type: 'artwork',
							_id: document
						}
					});
					bulkBody.push({
						doc: {
							bundle: newId
						}
					});
				})

				client.bulk({
					body: bulkBody
				}, function(error, response) {
					res.json({
						data: {
							_id: newId
						}
					});
				});
			}
		});
	}

}

function postBundle(req, res) {
	client.update({
		index: config.index,
		type: 'bundle',
		id: req.body.id,
		body: {
			doc: req.body
		}
	}, function(error, response) {
		res.json({response: 'post'});
	});
}

function putDocument(req, res) {
//	res.json({response: 'put'});

	var document = req.body;

	if (document.images && document.images.length > 0) {
		var sortedImages = _.sortBy(document.images, function(image) {
			return image.page && Number(image.page.order) || 0;
		});

		document.images = sortedImages;
	}

	client.create({
		index: config.index,
		type: 'artwork',
		id: req.body.id,
		body: document
	}, function(error, response) {
		res.json(response);
		//res.json({response: 'post'});
	});
}

function postDocument(req, res) {
	var document = req.body;

	if (document.images && document.images.length > 0) {
		var sortedImages = _.sortBy(document.images, function(image) {
			return image.page && Number(image.page.order) || 0;
		});

		document.images = sortedImages;
	}

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

	client.search({
		index: config.index,
		type: 'artwork',
		size: 1,
		from: 0,
		q: '_id: '+req.params.id
	}, function(error, response) {
		res.json({
			data: _.map(response.hits.hits, function(item) {
				var ret = item._source;
				ret.id = item._id;
				return ret;
			})[0]
		});
	});
}

function getMuseums(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			"aggs": {
				"museums": {
					"terms": {
						"field": "collection.museum.raw",
						"size": 10,
						"order": {
							"_count": "desc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.museums.buckets, function(museum) {
			return {
				value: museum.key
			};
		}));
	});
}

function getBundles(req, res) {
	var pageSize = 30;

	var query = [];

	if (req.query.museum) {
		query.push('collection.museum: "'+req.query.museum+'"');
	}
	if (req.query.search) {
		query.push('(title: "'+req.query.search+'" OR description: "'+req.query.search+'")');
	}

	client.search({
		index: config.index,
		type: 'bundle',
		size: pageSize,
		from: req.query.page && req.query.page > 0 ? (req.query.page-1)*pageSize : 0,
		sort: [
			'bundle'
		],
		q: query.length > 0 ? query.join(' AND ') : null
	}, function(error, response) {
		res.json({
			total: response.hits.total,
			bundles: _.map(response.hits.hits, function(item) {
				var ret = item._source;
				ret.id = item._id;
				return ret;
			}),
			query: query.length > 0 ? query.join(' AND ') : null
		});
	});
}

function getTechnic(req, res) {
	var queryBody = {
		"aggs": {
			"technic": {
				"terms": {
					"field": "technic.value",
					"size": 200
				}
			}
		}
	};

	if (!req.query.sort || req.query.sort != 'doc_count') {
		queryBody.aggs.technic.terms['order'] = {
			_term: 'asc'
		}
	}

	client.search({
		index: config.index,
		type: 'artwork',
		body: queryBody
	}, function(error, response) {
		res.json(_.map(response.aggregations.technic.buckets, function(technic) {
			return technic.key;
		}));
	});
}

function getMaterial(req, res) {
	var queryBody = {
		"aggs": {
			"material": {
				"terms": {
					"field": "material",
					"size": 200
				}
			}
		}
	};

	if (!req.query.sort || req.query.sort != 'doc_count') {
		queryBody.aggs.persons.terms['order'] = {
			_term: 'asc'
		}
	}

	client.search({
		index: config.index,
		type: 'artwork',
		body: queryBody
	}, function(error, response) {
		res.json(_.map(response.aggregations.material.buckets, function(material) {
			return {
				value: material.key,
				doc_count: material.doc_count
			};
		}));
	});
}

function getTypes(req, res) {
	var queryBody = {
		"aggs": {
			"types": {
				"terms": {
					"field": "type.raw",
					"size": 5000
				}
			}
		}
	};

	if (!req.query.sort || req.query.sort != 'doc_count') {
		queryBody.aggs.types.terms['order'] = {
			_term: 'asc'
		}
	}

	client.search({
		index: config.index,
		type: 'artwork',
		body: queryBody
	}, function(error, response) {
		res.json(_.map(_.filter(response.aggregations.types.buckets, function(type) {
			return type.key != '';
		}), function(type) {
			return {
				value: type.key,
				doc_count: type.doc_count
			};
		}));
	});
}

function getTags(req, res) {
	var queryBody = {
		"aggs": {
			"tags": {
				"terms": {
					"field": "tags.raw",
					"size": 5000
				}
			}
		}
	};

	if (!req.query.sort || req.query.sort != 'doc_count') {
		queryBody.aggs.tags.terms['order'] = {
			_term: 'asc'
		}
	}

	client.search({
		index: config.index,
		type: 'artwork',
		body: queryBody
	}, function(error, response) {
		res.json(_.map(response.aggregations.tags.buckets, function(tag) {
			return {
				value: tag.key,
				doc_count: tag.doc_count
			};
		}));
	});
}

function getPagetypes(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			"aggs": {
				"side": {
					"terms": {
						"field": "page.side",
						"size": 5000
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.side.buckets, function(side) {
			return {
				value: side.key
			};
		}));
	});
}

function getPersons(req, res) {
	var queryBody = {
		"aggs": {
			"persons": {
				"terms": {
					"field": "persons.raw",
					"size": 5000
				}
			}
		}
	};

	if (!req.query.sort || req.query.sort != 'doc_count') {
		queryBody.aggs.persons.terms['order'] = {
			_term: 'asc'
		}
	}

	client.search({
		index: config.index,
		type: 'artwork',
		body: queryBody
	}, function(error, response) {
		res.json(_.map(response.aggregations.persons.buckets, function(person) {
			return {
				value: person.key,
				doc_count: person.doc_count
			};
		}));
	});
}

function getPlaces(req, res) {
	var queryBody = {
		"aggs": {
			"places": {
				"terms": {
					"field": "places.raw",
					"size": 5000
				}
			}
		}
	};

	if (!req.query.sort || req.query.sort != 'doc_count') {
		queryBody.aggs.places.terms['order'] = {
			_term: 'asc'
		}
	}

	client.search({
		index: config.index,
		type: 'artwork',
		body: queryBody
	}, function(error, response) {
		res.json(_.map(response.aggregations.places.buckets, function(place) {
			return {
				value: place.key,
				doc_count: place.doc_count
			};
		}));
	});
}

function getGenres(req, res) {
	var queryBody = {
		"aggs": {
			"genres": {
				"terms": {
					"field": "genre.raw",
					"size": 5000
				}
			}
		}
	};

	if (!req.query.sort || req.query.sort != 'doc_count') {
		queryBody.aggs.genres.terms['order'] = {
			_term: 'asc'
		}
	}

	client.search({
		index: config.index,
		type: 'artwork',
		body: queryBody
	}, function(error, response) {
		res.json(_.map(response.aggregations.genres.buckets, function(genre) {
			return {
				value: genre.key,
				doc_count: genre.doc_count
			};
		}));
	});
}

function getExhibitions(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			"aggs": {
				"exhibitions": {
					"terms": {
						"field": "exhibitions.raw",
						"size": 200,
						"order": {
							"_term": "asc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.exhibitions.buckets, function(genre) {
			return {
				value: genre.key
			};
		}));
	});
}

function getGoogleVisionLabels(req, res) {
	var query = createQuery(req);

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
								size: 1000
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

function getArtworkRelations(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			size: 10000,
			query: {
				query_string: {
					query: '*'
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.hits.hits, function(hit) {
			var ret = {
				id: hit._id,
				type: hit._source.type,
				museum: hit._source.collection ? hit._source.collection.museum : null,
				title: hit._source.title,
				persons: hit._source.persons,
				genre: hit._source.genre,
				places: hit._source.places,
				tags: hit._source.tags,
				images: _.map(hit._source.images, function(image) {
					return image.image
				}),
			};

			if (hit._source.images && hit._source.images[0] && hit._source.images[0].color) {
				ret.dominant_1_h = hit._source.images[0].color.colors.three[0].hsv.h;
				ret.dominant_1_s = hit._source.images[0].color.colors.three[0].hsv.s;
				ret.dominant_1_v = hit._source.images[0].color.colors.three[0].hsv.v;

				ret.dominant_2_h = hit._source.images[0].color.colors.three[1].hsv.h;
				ret.dominant_2_s = hit._source.images[0].color.colors.three[1].hsv.s;
				ret.dominant_2_v = hit._source.images[0].color.colors.three[1].hsv.v;

				ret.dominant_3_h = hit._source.images[0].color.colors.three[2].hsv.h;
				ret.dominant_3_s = hit._source.images[0].color.colors.three[2].hsv.s;
				ret.dominant_3_v = hit._source.images[0].color.colors.three[2].hsv.v;
			}

			return ret;
		}));
	});
}

var labelScoreMargins = 0.2;
var colorMargins = 5;
var colorScoreMargins = 0.2;

var minumumLabelScore = 0.7;
var minimumColorScore = 0.2;

var googleLabelsBlacklist = [
//	'painting',
	'art',
//	'illustration',
	'document',
	'artwork',
	'modern',
	'visual',
	'arts',
	'black'
];

function getSimilarDocuments(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		size: 1,
		from: 0,
		q: '_id: '+req.query.id
	}, function(error, response) {
		if (response.hits.hits.length > 0) {
			var lookupLabels = _.filter(response.hits.hits[0]._source.googleVisionLabels, function(label) {
				var blacklist = googleLabelsBlacklist;

				return _.intersection(label.label.split(' '), blacklist) == 0;
			});

			var nestedLabelsQuery = _.map(_.filter(lookupLabels, function(label) {
//				return true;
				return label.score > minumumLabelScore;
			}), function(label) {
				return {
					nested: {
						path: "googleVisionLabels",
						query: {
							bool: {
								must: [
									{
										term: {
											"googleVisionLabels.label": {
												value: label.label
											}
										}
									},
									{
										range: {
											"googleVisionLabels.score": {
												gte: label.score-(labelScoreMargins),
												lte: label.score+(labelScoreMargins)
											}
										}
									}
								]
							}
						}
					}
				};
			});

			var lookupColors = response.hits.hits[0]._source.googleVisionColors.sort(function(a, b) {
				return true;
//				return a.score-b.score;
			}).reverse();

//			lookupColors = lookupColors.splice(0, Math.round(lookupColors.length/2));

			var nestedColorsQuery = _.map(_.filter(lookupColors, function(color) {
				return true;
//				return color.score > minimumColorScore;
			}), function(color) {
				return {
					nested: {
						path: "googleVisionColors",
						query: {
							bool: {
								must: [
									{
										range: {
											'googleVisionColors.hsv.h': {
												gte: color.hsv.h-(colorMargins),
												lte: color.hsv.h+(colorMargins)
											}
										}
									},
									{
										range: {
											'googleVisionColors.hsv.s': {
												gte: color.hsv.s-(colorMargins),
												lte: color.hsv.s+(colorMargins)
											}
										}
									},
									/*
									{
										range: {
											'googleVisionColors.hsv.v': {
												gte: color.hsv.v-(colorMargins),
												lte: color.hsv.v+(colorMargins)
											}
										}
									},
									*/
									{
										range: {
											'googleVisionColors.score': {
												gte: color.score-colorScoreMargins,
												lte: color.score+colorScoreMargins
											}
										}
									}
								]
							}
						}
					}
				};
			});

			var query = {
				query: {
					bool: {
						must_not: {
							/*
							'term': {
								'published': 'false'
							},
							*/
							ids: {
								type: 'artwork',
								values: [req.query.id]
							}
						},
						should: nestedLabelsQuery.concat(nestedColorsQuery)
					}
				}
			};

			var pageSize = req.query.count || 100;

			client.search({
				index: config.index,
				type: 'artwork',
				size: req.query.showAll && req.query.showAll == 'true' ? 10000 : (req.query.size || pageSize),
				from: req.query.showAll && req.query.showAll == 'true' ? 0 : (req.query.page && req.query.page > 0 ? (req.query.page-1)*pageSize : 0),
				body: query
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
									delete image.color.colors;
								}
							})
						}

						return ret;
					}) : []
				});
			});
		}
	});
}

function getSimilarLabelsDocuments(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		size: 1,
		from: 0,
		q: '_id: '+req.query.id
	}, function(error, response) {
		if (response.hits.hits.length > 0) {
			var lookupLabels = _.filter(response.hits.hits[0]._source.googleVisionLabels, function(label) {
				var blacklist =googleLabelsBlacklist;

				return _.intersection(label.label.split(' '), blacklist) == 0;
//				return true;
			});

			var nestedLabelsQuery = _.map(_.filter(lookupLabels, function(label) {
				return true;
//				return label.score > minumumLabelScore;
			}), function(label) {
				return {
					nested: {
						path: "googleVisionLabels",
						query: {
							bool: {
								must: [
									{
										term: {
											"googleVisionLabels.label": {
												value: label.label
											}
										}
									},
									{
										range: {
											"googleVisionLabels.score": {
												gte: label.score-(labelScoreMargins),
												lte: label.score+(labelScoreMargins)
											}
										}
									}
								]
							}
						}
					}
				};
			});

			var query = {
				query: {
					bool: {
						must_not: {
							/*
							'term': {
								'published': 'false'
							},
							*/
							ids: {
								type: 'artwork',
								values: [req.query.id]
							}
						},
						should: nestedLabelsQuery
					}
				}
			};

			var pageSize = req.query.count || 100;

			client.search({
				index: config.index,
				type: 'artwork',
				size: req.query.showAll && req.query.showAll == 'true' ? 10000 : (req.query.size || pageSize),
				from: req.query.showAll && req.query.showAll == 'true' ? 0 : (req.query.page && req.query.page > 0 ? (req.query.page-1)*pageSize : 0),
				body: query
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
									delete image.color.colors;
								}
							})
						}

						return ret;
					}) : []
				});
			});
		}
	});
}

function getSimilarColorsDocuments(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		size: 1,
		from: 0,
		q: '_id: '+req.query.id
	}, function(error, response) {
		if (response.hits.hits.length > 0) {
			var colorMargins = 5;
			var scoreMargins = 0.5;

			var lookupColors = response.hits.hits[0]._source.googleVisionColors.sort(function(a, b) {
				return true;
//				return a.score-b.score;
			}).reverse();

//			lookupColors = lookupColors.splice(0, Math.round(lookupColors.length/2));

			var nestedColorsQuery = _.map(_.filter(lookupColors, function(color) {
				return true;
//				return color.score > minimumColorScore;
			}), function(color) {
				return {
					nested: {
						path: "googleVisionColors",
						query: {
							bool: {
								must: [
									{
										range: {
											'googleVisionColors.hsv.h': {
												gte: Number(color.hsv.h-(colorMargins)),
												lte: Number(color.hsv.h+(colorMargins))
											}
										}
									},
									{
										range: {
											'googleVisionColors.hsv.s': {
												gte: Number(color.hsv.s-(colorMargins)),
												lte: Number(color.hsv.s+(colorMargins))
											}
										}
									},
									/*
									{
										range: {
											'googleVisionColors.hsv.v': {
												gte: color.hsv.v-(colorMargins),
												lte: color.hsv.v+(colorMargins)
											}
										}
									},
									*/
									{
										range: {
											'googleVisionColors.score': {
												gte: Number(color.score-scoreMargins),
												lte: Number(color.score+scoreMargins)
											}
										}
									}
								]
							}
						}
					}
				};
			});

			var query = {
				query: {
					bool: {
						must_not: {
							/*
							'term': {
								'published': 'false'
							},
							*/
							ids: {
								type: 'artwork',
								values: [req.query.id]
							}
						},
						must: {
							term: {
								type: 'konstverk'
							}
						},
						should: nestedColorsQuery,
						minimum_should_match: '75%'
					}
				}
			};

			var pageSize = req.query.count || 100;

			client.search({
				index: config.index,
				type: 'artwork',
				size: req.query.showAll && req.query.showAll == 'true' ? 10000 : (req.query.size || pageSize),
				from: req.query.showAll && req.query.showAll == 'true' ? 0 : (req.query.page && req.query.page > 0 ? (req.query.page-1)*pageSize : 0),
				body: query
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
									delete image.color.colors;
								}
							})
						}

						return ret;
					}) : []
				});
			});
		}
	});
}

function getColorMap(req, res) {
	var nestedPath = 'googleVisionColors';
	var query = createQuery(req);

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
/*
			aggs: {
				titles: {
					terms: {
						field: 'title.raw',
						size: 10,
						order: {
							_term: 'asc'
						}
					}
				}
			}
*/
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

function getNeo4jArtworkRelations(req, res) {
	request.post('http://localhost:7474/db/data/cypher', {
		'auth': {
			'user': 'neo4j',
			'pass': 'lcp010xx',
			'sendImmediately': false
		},
		json: true,
		body: {
			"query" : "MATCH (n1:Object)-[r1:SHARE_TAG]-(n2:Object) WHERE n1.type = {type} AND n2.type = {type} RETURN n1, r1, n2",
			"params" : {
				"type" : "Konstverk"
			}
		}
	}, function(error, response, body) {
		var getNodeIndex = function(id) {
			return _.findIndex(output.nodes, function(node) {
				return node.id == id;
			});
		}

		var output = {
			nodes: [],
			connections: [],
			//raw: response
		};

		_.each(response.body.data, function(item) {
			_.each(item, function(subItem) {

				if (subItem.metadata.type != 'SHARE_TAG') {
					var node = subItem.data;
					node.es_id = subItem.data.id;
					node.id = subItem.metadata.id;
					node.label = subItem.metadata.labels[0];

					output.nodes.push(node);
				}
			});
		});

		_.each(response.body.data, function(item) {
			output.connections.push({
				source: item[0].metadata.id,
				target: item[2].metadata.id
			});
		});

		output.nodes = _.map(_.uniq(output.nodes, function(node) {
			return node.id;
		}), function(item, index) {
			item.index = index;
			return item;
		});

		res.json(output);
//		res.json(response);
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
		fstream = fs.createWriteStream(config.image_path+'\\'+filename);
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
/*
app.get(urlRoot+'/', function(req, res) {
	res.send(express.static('documentation'));
});
*/

app.use(express.static(__dirname + '/documentation'));

app.get(urlRoot+'/documents', getDocuments);
app.get(urlRoot+'/bundle/:bundle', getBundle);
app.get(urlRoot+'/document/:id', getDocument);
app.get(urlRoot+'/bundles', getBundles);
app.get(urlRoot+'/museums', getMuseums);
app.get(urlRoot+'/technic', getTechnic);
app.get(urlRoot+'/material', getMaterial);
app.get(urlRoot+'/types', getTypes);
app.get(urlRoot+'/tags', getTags);
app.get(urlRoot+'/pagetypes', getPagetypes);
app.get(urlRoot+'/persons', getPersons);
app.get(urlRoot+'/places', getPlaces);
app.get(urlRoot+'/genres', getGenres);
app.get(urlRoot+'/exhibitions', getExhibitions);
app.get(urlRoot+'/colormap', getColorMap);
app.get(urlRoot+'/colormatrix', getColorMatrix);
app.get(urlRoot+'/artwork_relations', getArtworkRelations);
app.get(urlRoot+'/similar', getSimilarDocuments)
app.get(urlRoot+'/similar/labels', getSimilarLabelsDocuments)
app.get(urlRoot+'/similar/colors', getSimilarColorsDocuments)

app.get(urlRoot+'/next/:insert_id', getNextId);
app.get(urlRoot+'/prev/:insert_id', getPrevId);
app.get(urlRoot+'/highest_insert_id', getHighestId);

app.get(urlRoot+'/googleVisionLabels', getGoogleVisionLabels);

app.get(urlRoot+'/neo4j_artwork_relations', getNeo4jArtworkRelations)

app.get(urlRoot+'/autocomplete', getAutoComplete);

app.get(urlRoot+'/year_range', getYearRange);

app.get(urlRoot+'/admin/login', adminLogin);
app.put(urlRoot+'/admin/documents/combine', putCombineDocuments);
app.get(urlRoot+'/admin/documents', adminGetDocuments);
app.get(urlRoot+'/admin/bundle/:bundle', getBundle);
app.put(urlRoot+'/admin/bundle', putBundle);
app.post(urlRoot+'/admin/bundle/:id', postBundle);
app.put('/admin/document/:id', putDocument);
app.post('/admin/document/:id', postDocument);
app.get('/admin/document/:id', getDocument);
app.get('/admin/bundles', getBundles);
app.get('/admin/museums', getMuseums);
app.get('/image_file_list', getImageFileList);
app.post('/admin/upload', postImageUpload);

app.listen(3010, function () {
  console.log('Arosenius project API');
});
