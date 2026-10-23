const express = require('express');
const { metaRouter } = require('./meta');
const { catalogRouter } = require('./catalog');
const { chaptersRouter } = require('./chapters');
const { sectionsRouter } = require('./sections');

function apiRouter() {
  const router = express.Router();
  router.use(metaRouter());
  router.use(catalogRouter());
  router.use(chaptersRouter());
  router.use(sectionsRouter());
  return router;
}

module.exports = { apiRouter };
