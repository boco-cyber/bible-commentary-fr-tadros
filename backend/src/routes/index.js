const express = require('express');
const { metaRouter } = require('./meta');
const { catalogRouter } = require('./catalog');
const { chaptersRouter } = require('./chapters');
const { sectionsRouter } = require('./sections');
const { parallelRouter } = require('./parallel');
const { referencesRouter } = require('./references');
const { searchRouter } = require('./search');

function apiRouter() {
  const router = express.Router();
  router.use(metaRouter());
  router.use(catalogRouter());
  router.use(chaptersRouter());
  router.use(sectionsRouter());
  router.use(parallelRouter());
  router.use(referencesRouter());
  router.use(searchRouter());
  return router;
}

module.exports = { apiRouter };
