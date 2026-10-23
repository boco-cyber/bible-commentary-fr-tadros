const express = require('express');
const { navigationRouter } = require('./navigation');
const { metaRouter } = require('./meta');
const { catalogRouter } = require('./catalog');
const { chaptersRouter } = require('./chapters');
const { sectionsRouter } = require('./sections');
const { parallelRouter } = require('./parallel');
const { referencesRouter } = require('./references');
const { searchRouter } = require('./search');
const { scriptureRouter } = require('./scripture');
const { studyRouter } = require('./study');
const { verseCommentaryRouter } = require('./verse-commentary');

function apiRouter() {
  const router = express.Router();
  router.use(navigationRouter());
  router.use(metaRouter());
  router.use(catalogRouter());
  router.use(chaptersRouter());
  router.use(scriptureRouter());
  router.use(studyRouter());
  router.use(verseCommentaryRouter());
  router.use(sectionsRouter());
  router.use(parallelRouter());
  router.use(referencesRouter());
  router.use(searchRouter());
  return router;
}

module.exports = { apiRouter };
