var express = require('express');
var bodyParser = require('body-parser');
var _ = require('underscore');
var elasticsearch = require('elasticsearch');
var IMGR = require('imgr').IMGR;

var config = require('./config');

var app = express();
var auth = require('basic-auth')

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

var auth = require('basic-auth');

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

app.use(bodyParser.json());

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

function QueryBuilder() {
	this.queryBody = {};
}

QueryBuilder.prototype.addBool = function(terms, type, caseSensitive, nested, nestedPath, disableProcessing) {
	if (!this.queryBody['query']) {
		this.queryBody['query'] = {};
	}
	if (!this.queryBody.query['bool']) {
		this.queryBody.query['bool'] = {};
	}
	if (!this.queryBody.query.bool['must']) {
		this.queryBody.query.bool['must'] = [];
	}

	var boolObj = {
		bool: {}
	};

	boolObj.bool[type] = [];

	for (var i = 0; i<terms.length; i++) {
		if (disableProcessing) {
			console.log('disableProcessing')
			boolObj.bool[type].push(terms[i]);
		}
		else {		
			var propertyName = terms[i][2] ? terms[i][2] : 'term';
			var termObj = {};
			termObj[propertyName] = {}

			if (caseSensitive || propertyName != 'term') {
				termObj[propertyName][terms[i][0]] = terms[i][1];
			}
			else {
				termObj[propertyName][terms[i][0]] = terms[i][1].toLowerCase();
			}

			boolObj.bool[type].push(termObj);
		}
	}


	console.log(JSON.stringify(boolObj));

	if (nested) {
		this.queryBody.query.bool.must.push({
			nested: {
				path: nestedPath,
				query: boolObj
			}
		});
	}
	else {
		this.queryBody.query.bool.must.push(boolObj);
	}
}

function getDocuments(req, res) {
	var colorMargins = req.query.color_margins ? Number(req.query.color_margins) : 15;
	var pageSize = 100;

	var sort = [];

	var queryBuilder = new QueryBuilder();

	if (req.query.ids) {
		var docIds = req.query.ids.split(';');

		var query = {
			query: {
				bool: {
					should: _.map(docIds, function(docId) {
						return {
							term: {
								_id: docId
							}
						};
					})
				}
			}
		};
	}

	if (req.query.museum) {
		queryBuilder.addBool([
			['collection.museum', req.query.museum]
		], 'should', true);
	}

	if (req.query.bundle) {
		queryBuilder.addBool([
			['bundle', req.query.bundle]
		], 'should', true);

		sort.push('page.order');
	}

	if (req.query.search) {
		var searchTerms = req.query.search.replace(/:|-|\/|\\/g, ' ').split(' ');

		var terms = [];
		for (var i = 0; i<searchTerms.length; i++) {		
			terms.push(['title', searchTerms[i]]);
			terms.push(['description', searchTerms[i]]);
			terms.push(['museum_int_id', searchTerms[i]]);
		}

		terms.push(['collection.museum', req.query.search]);

		queryBuilder.addBool(terms, 'should');
	}

	if (req.query.type) {
		queryBuilder.addBool([
			['type', req.query.type]
		], 'should');
	}

	if (req.query.letter_from) {
		queryBuilder.addBool([
			['sender.name', req.query.letter_from]
		], 'should');
	}

	if (req.query.letter_to) {
		queryBuilder.addBool([
			['sender.recipient', req.query.letter_to]
		], 'should');
	}

	if (req.query.person) {
		var persons = req.query.person.split(';');

		_.each(persons, _.bind(function(person) {
			queryBuilder.addBool([
				['persons', person]
			], 'should', true);
		}, this));
	}

	if (req.query.place) {
		queryBuilder.addBool([
			['places', req.query.place]
		], 'should', true);
	}

	if (req.query.genre) {
		queryBuilder.addBool([
			['genre', req.query.genre]
		], 'should', true);
	}
/*
"query": {
	"bool": {
		"must": [
			{
				"nested": {
					"path": "images.color.colors.three",
					"query": {
						"bool": {
							"must": [
								{
									"range": {
										"images.color.colors.three.hsv.h": {
											"from": 31,
											"to": 61
										}
									}
								}, {
									"range": {
										"images.color.colors.three.hsv.s": {
											"from": 62,
											"to": 92
										}
									}
								}
							]
						}
					}

				}
			}
		]
	}
}
*/
	if (req.query.hue || req.query.saturation || req.query.lightness) {
		var nestedQuery = {
			nested: {
				path: "images.color.colors.three",
				query: {
					bool: {
						must: []
					}
				}
			}
		}

		if (req.query.hue) {
			var queryObject = {
				range: {
					"images.color.colors.three.hsv.h": {					
						from: Number(req.query.hue)-colorMargins,
						to: Number(req.query.hue)+colorMargins
					}
				}
			};

			nestedQuery.nested.query.bool.must.push(queryObject);
		}

		if (req.query.saturation) {
			var queryObject = {
				range: {
					"images.color.colors.three.hsv.s": {					
						from: Number(req.query.saturation)-colorMargins,
						to: Number(req.query.saturation)+colorMargins
					}
				}
			};

			nestedQuery.nested.query.bool.must.push(queryObject);
		}

		if (req.query.lightness) {
			var queryObject = {
				range: {
					"images.color.colors.three.hsv.v": {					
						from: Number(req.query.lightness)-colorMargins,
						to: Number(req.query.lightness)+colorMargins
					}
				}
			};

			nestedQuery.nested.query.bool.must.push(queryObject);
		}

		var nestedTerms = [];

		nestedTerms.push(nestedQuery);

		queryBuilder.addBool(nestedTerms, 'must', false, true, 'images', true);
	}

/*
	if (req.query.hue || req.query.saturation || req.query.lightness) {
		var colorPath = req.query.prominent ? 'color.colors.prominent' : 'color.colors.three';

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

		queryBuilder.addBool(terms, 'must', false, true, colorPath);
	}
*/
	sort.push('batchnumber:desc');
	sort.push('bundle:asc');
	sort.push('page.id:asc');

	client.search({
		index: config.index,
		type: 'artwork',
		size: req.query.showAll && req.query.showAll == 'true' ? 10000 : pageSize,
		from: req.query.showAll && req.query.showAll == 'true' ? 0 : (req.query.page && req.query.page > 0 ? (req.query.page-1)*pageSize : 0),
		sort: sort,
		body: req.query.ids ? query : queryBuilder.queryBody
	}, function(error, response) {
		res.json({
			query: queryBuilder.queryBody,
			total: response.hits ? response.hits.total : 0,
			documents: response.hits ? _.map(response.hits.hits, function(item) {
				var ret = item._source;
				ret.id = item._id;
				return ret;
			}) : []
		});
	});
}

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
					console.log(response);
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
					console.log(error);
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
	res.json({response: 'put'});
}

function postDocument(req, res) {
	var document = req.body;

	if (document.images && document.images.length > 0) {
		console.log('sort images');
		var sortedImages = _.sortBy(document.images, function(image) {
			console.log(image);
			return image.page.order || 0;
		});

		console.log(sortedImages);

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
						"field": "collection.museum",
						"size": 5,
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
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			"aggs": {
				"technic": {
					"terms": {
						"field": "technic.value",
						"size": 200,
						"order": {
							"_term": "asc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.technic.buckets, function(technic) {
			return technic.key;
		}));
	});
}

function getMaterial(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			"aggs": {
				"material": {
					"terms": {
						"field": "material",
						"size": 200,
						"order": {
							"_term": "asc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.material.buckets, function(material) {
			return {
				value: material.key
			};
		}));
	});
}

function getTypes(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			"aggs": {
				"types": {
					"terms": {
						"field": "type",
						"size": 200,
						"order": {
							"_term": "asc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(_.filter(response.aggregations.types.buckets, function(type) {
			return type.key != '';
		}), function(type) {
			return {
				value: type.key
			};
		}));
	});
}

function getTags(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			"aggs": {
				"tags": {
					"terms": {
						"field": "tags",
						"size": 200,
						"order": {
							"_term": "asc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.tags.buckets, function(tag) {
			return {
				value: tag.key
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
						"size": 200,
						"order": {
							"_term": "asc"
						}
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
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			"aggs": {
				"persons": {
					"terms": {
						"field": "persons",
						"size": 200,
						"order": {
							"_term": "asc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.persons.buckets, function(person) {
			return {
				value: person.key
			};
		}));
	});
}

function getPlaces(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			"aggs": {
				"places": {
					"terms": {
						"field": "places",
						"size": 200,
						"order": {
							"_term": "asc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.places.buckets, function(place) {
			return {
				value: place.key
			};
		}));
	});
}

function getGenres(req, res) {
	client.search({
		index: config.index,
		type: 'artwork',
		body: {
			"aggs": {
				"genres": {
					"terms": {
						"field": "genre",
						"size": 200,
						"order": {
							"_term": "asc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.genres.buckets, function(genre) {
			return {
				value: genre.key
			};
		}));
	});
}

function getColorMap(req, res) {
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
					return saturation.key;
				})
			};
		}));

	});
/*
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
					terms: {
						field: 'color.dominant.hsv.h',
						size: 360,
						order: {
							_term: "asc"
						}
					},
					aggs: {
						saturation: {
							terms: {
								field: 'color.dominant.hsv.s',
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
	}, function(error, response) {
		res.json(_.map(response.aggregations.hue.buckets, function(hue) {
			return {
				hue: hue.key,
				saturation: _.map(hue.saturation.buckets, function(saturation) {
					return saturation.key;
				})
			};
		}));
	});
*/
}

var imgr = new IMGR({
	cache_dir: config.image_temp_path
});

imgr.serve(config.image_path)
	.namespace('/images')
	.urlRewrite('/:path/:size/:file.:ext')
	.using(app);

app.get('/', function(req, res) {
	res.send('Arosenius API');
});

app.get('/documents', getDocuments);
app.get('/bundle/:bundle', getBundle);
app.get('/document/:id', getDocument);
app.get('/bundles', getBundles);
app.get('/museums', getMuseums);
app.get('/technic', getTechnic);
app.get('/material', getMaterial);
app.get('/types', getTypes);
app.get('/tags', getTags);
app.get('/pagetypes', getPagetypes);
app.get('/persons', getPersons);
app.get('/places', getPlaces);
app.get('/genres', getGenres);
app.get('/colormap', getColorMap);

app.get('/admin/login', adminLogin);
app.put('/admin/documents/combine', putCombineDocuments);
app.get('/admin/documents', getDocuments);
app.get('/admin/bundle/:bundle', getBundle);
app.put('/admin/bundle', putBundle);
app.post('/admin/bundle/:id', postBundle);
app.put('/admin/document/:id', putDocument);
app.post('/admin/document/:id', postDocument);
app.get('/admin/document/:id', getDocument);
app.get('/admin/bundles', getBundles);
app.get('/admin/museums', getMuseums);

app.listen(3000, function () {
  console.log('Arosenius project API');
});