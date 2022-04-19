const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler')
const config = require("../config.js");
const moment = require('moment')

router.get('/connectivity', asyncHandler(async (req, res, next) => {
  const service = res.app.locals.connS
  const networks = await service.scan()
  res.render('connectivity', {category: 'Connectivity', networks})
}))

module.exports = router;