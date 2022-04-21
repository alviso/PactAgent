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

router.get('/addWifi', asyncHandler(async (req, res, next) => {
  const service = res.app.locals.connS
  const log = await service.exec('sudo wpa_cli -i wlan0 list_networks')
  res.send(log)
}))

module.exports = router;