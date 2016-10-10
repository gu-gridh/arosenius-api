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

var auth = require('basic-auth');

app.use(function(req, res, next) {
	var user = auth(req);

	if (req.path.substr(0, 7).toLowerCase() != '/admin/') {
		next();
	}
	else if (user === undefined || user['name'] !== 'arosenius' || user['pass'] !== 'dBe55yrPMK') {
		res.setHeader('WWW-Authenticate', 'Basic realm="AroseniusAdminApi"');
		res.header('Access-Control-Allow-Origin', '*');
		res.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT')
		res.header('Access-Control-Allow-Headers', 'Authorization,Access-Control-Allow-Headers,Origin,Accept,X-Requested-With,Content-Type,Access-Control-Request-Method,Access-Control-Allow-Headers')
        res.end('Unauthorized');
    } else {
        next();
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

var adminLogin = function(req, res) {
	res.json({
		login: 'success'
	});
};

var getDocuments = function(req, res) {
	var pageSize = 30;

	var query = [];

	if (req.query.museum) {
		query.push('collection.museum: "'+req.query.museum+'"');
	}

	if (req.query.bundle) {
		query.push('bundle: "'+req.query.bundle+'"');
	}

	if (req.query.search) {
		query.push('(title: "*'+req.query.search+'*" OR description: "*'+req.query.search+'*")');
	}

	if (req.query.type) {
		query.push('type: "'+req.query.type+'"');
	}

	if (req.query.letter_from) {
		query.push('(sender.firstname: "*'+req.query.letter_from+'*" OR sender.surname: "*'+req.query.letter_from+'*")');
	}

	if (req.query.letter_to) {
		query.push('(recipient.firstname: "*'+req.query.letter_to+'*" OR recipient.surname: "*'+req.query.letter_to+'*")');
	}

	if (req.query.lightness) {
		query.push('color.dominant.hsv.v: ['+(req.query.lightness-10)+' TO '+(req.query.lightness+10)+']')
	}

	if (req.query.hue) {
		query.push('color.dominant.hsv.h: ['+(req.query.hue-10)+' TO '+(req.query.hue+10)+']')
	}

	if (req.query.saturation) {
		query.push('color.dominant.hsv.s: ['+(req.query.saturation-10)+' TO '+(req.query.saturation+10)+']')
	}

	client.search({
		index: 'arosenius',
		type: 'artwork',
		size: req.query.showAll && req.query.showAll == 'true' ? 1000 : pageSize,
		from: req.query.showAll && req.query.showAll == 'true' ? 0 : (req.query.page && req.query.page > 0 ? (req.query.page-1)*pageSize : 0),
		sort: [
			'bundle',
			'page.id'
		],
		q: query.length > 0 ? query.join(' AND ') : null
	}, function(error, response) {
		res.json({
			total: response.hits.total,
			documents: _.map(response.hits.hits, function(item) {
				var ret = item._source;
				ret.id = item._id;
				return ret;
			})
		});
	});
};

var getBundle = function(req, res) {
	var pageSize = 30;

	var query = [];

	query.push('bundle: "'+req.params.bundle+'"');

	client.search({
		index: 'arosenius',
		type: 'bundle',
		q: 'bundle: "'+req.params.bundle+'"'
	}, function(error, response) {
		res.json({
			data: response.hits.hits[0]._source
		});
	});

};

var postBundle = function(req, res) {
	client.update({
		index: 'arosenius',
		type: 'bundle',
		id: req.body.id,
		body: {
			doc: req.body
		}
	}, function(error, response) {
		res.json({response: 'post'});
	});
};

var putDocument = function(req, res) {
	console.log(req);
	res.json({response: 'put'});
};

var postDocument = function(req, res) {
	client.update({
		index: 'arosenius',
		type: 'artwork',
		id: req.body.id,
		body: {
			doc: req.body
		}
	}, function(error, response) {
		res.json({response: 'post'});
	});
};

var getDocument = function(req, res) {
	var query = [];
	if (req.query.museum) {
		query.push('collection.museum: "'+req.query.museum+'"');
	}

	client.search({
		index: 'arosenius',
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
};

var getMuseums = function(req, res) {
	client.search({
		index: 'arosenius',
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
				museum: museum.key
			};
		}));
	});
};

var getBundles = function(req, res) {
	var pageSize = 30;

	var query = [];

	if (req.query.museum) {
		query.push('collection.museum: "'+req.query.museum+'"');
	}

	client.search({
		index: 'arosenius',
		type: 'bundle',
		size: pageSize,
		from: req.query.page && req.query.page > 0 ? (req.query.page-1)*pageSize : 0,
		sort: [
			'bundle'
		],
		q: query.length > 0 ? query.join(', ') : null
	}, function(error, response) {
		res.json({
			total: response.hits.total,
			bundles: _.map(response.hits.hits, function(item) {
				var ret = item._source;
				ret.id = item._id;
				return ret;
			})
		});
	});
};

var getTechnic = function(req, res) {
	client.search({
		index: 'arosenius',
		type: 'artwork',
		body: {
			"aggs": {
				"technic": {
					"terms": {
						"field": "technic.value",
						"size": 50,
						"order": {
							"_count": "desc"
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
};

var getMaterial = function(req, res) {
	client.search({
		index: 'arosenius',
		type: 'artwork',
		body: {
			"aggs": {
				"material": {
					"terms": {
						"field": "material",
						"size": 50,
						"order": {
							"_count": "desc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.material.buckets, function(material) {
			return material.key;
		}));
	});
};

var getTypes = function(req, res) {
	client.search({
		index: 'arosenius',
		type: 'artwork',
		body: {
			"aggs": {
				"types": {
					"terms": {
						"field": "type",
						"size": 50,
						"order": {
							"_count": "desc"
						}
					}
				}
			}
		}
	}, function(error, response) {
		res.json(_.map(response.aggregations.types.buckets, function(type) {
			return type.key;
		}));
	});
};

var imgr = new IMGR({
	cache_dir: '/tmp/imgr'
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

app.get('/admin/login', adminLogin);
app.get('/admin/documents', getDocuments);
app.get('/admin/bundle/:bundle', getBundle);
app.post('/admin/bundle/:id', postBundle);
app.put('/admin/document/:id', putDocument);
app.post('/admin/document/:id', postDocument);
app.get('/admin/document/:id', getDocument);
app.get('/admin/bundles', getBundles);
app.get('/admin/museums', getMuseums);

app.listen(3000, function () {
  console.log('Arosenius project API');
});