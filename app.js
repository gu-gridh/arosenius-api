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
	client.search({
		index: 'arosenius',
		type: 'artwork',
		size: 30,
		from: 0
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

app.get('/documents/museum/:museum', function(req, res) {
	client.search({
		index: 'arosenius',
		type: 'artwork',
		size: 30,
		from: 0,
		q: 'collection.museum: "'+req.params.museum+'"'
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

app.listen(3000, function () {
  console.log('Example app listening on port 3000!');
});