const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler')
const config = require("../config.js");
const moment = require('moment')
const github = require('../services/githubService')


router.get('/', isLoggedIn, asyncHandler(async (req, res, next) => {
  const service = res.app.locals.pAS[res.app.locals.chain.name]
  const balances = await service.getBalances()
  const cycles = await service.readCycles()
  const myCoord = await service.getMyCoord()
  const dates = {monthago: moment().subtract(14, 'days').format('MMM Do'), today:moment().format('MMM Do')}
  res.render('agentDash', {category: 'Pact Agent', balances, dates, cycles, myCoord})
}))

router.get('/home', asyncHandler(async (req, res, next) => {
  const service = res.app.locals.pAS[res.app.locals.chain.name]
  const nGw = await service.getNumberOfGateways()
  const dCRKK = await service.getDistributedCRKK()
  const lastCycle = await service.getLastCycle()
  const PoCC = await service.getCount('allCycles') - 223
  // const lastCommit = await github.getLastCommit()
  const prc = service.round(dCRKK / config.kadena.totSup * 100, 3)
  res.render('home', {naked:true, nGw, dCRKK, prc, lastCommit, PoCC, lastCycle})
}))

router.get('/logout', isLoggedIn,(req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    return res.redirect('/');
  });
})

router.get('/login',(req, res, next) => {
  res.render('login', {naked:true})
})

function isLoggedIn(req, res, next) {
  if (config.physical) next()
  else req.user ? next() : res.redirect('/login') //res.sendStatus(401)
}

module.exports = router;