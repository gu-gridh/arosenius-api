var express = require('express');
var _ = require('underscore');
var elasticsearch = require('elasticsearch');

var app = express();

var client = new elasticsearch.Client({
	host: '127.0.0.1:9200',
	log: 'trace'
});

app.get('/', function(req, res) {
  res.send('Hello World!');
});

app.get('/documents', function(req, res) {
	var query = [];
	if (req.query.museum) {
		query.push('collection.museum: "'+req.query.museum+'"');
	}
	if (req.query.type )

	client.search({
		index: 'arosenius',
		type: 'artwork',
		size: 30,
		from: 0,
		q: query.length > 0 ? query.join(', ') : null
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
});

app.get('/museums', function(req, res) {
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
			return museum.key;
		}));
	});
});

app.get('/technic', function(req, res) {
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
});

app.get('/material', function(req, res) {
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
});

app.listen(3000, function () {
  console.log('Example app listening on port 3000!');
});