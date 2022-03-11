const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler')
const config = require("../config.js");
const moment = require('moment')
const {format} = require("morgan");


router.get('/', asyncHandler(async (req, res, next) => {
  const service = res.app.locals.pAS[res.app.locals.chain.name]
  // const modules = await service.getActiveModules()
  // const crankcount = await service.getTodaysCranks()
  // const nodes = await service.getActiveNodes()
  // const scripts = await service.getScripts()
  // const tasks = await service.getTasks()
  // const executions = await service.getExecutions()
  const balances = await service.getBalances()
  const dates = {monthago: moment().subtract(21, 'days').format('MMM Do'), today:moment().format('MMM Do')}
  // const nodecount = nodes.length
  res.render('agentDash', {category: 'Pact Agent', balances, dates}) //modules, nodes, scripts, tasks, executions, nodecount, crankcount, balances, dates
}))

router.get('/home', asyncHandler(async (req, res, next) => {
  res.render('home', {naked:true})
}))

router.get('/nodestats', asyncHandler(async (req, res, next) => {
  const service = res.app.locals.pAS[res.app.locals.chain.name]
  const nodes = await service.getActiveNodes()
  const nodecount = nodes.length
  res.render('nodestats', {naked:true, nodecount})
}))

router.get('/crankstats', asyncHandler(async (req, res, next) => {
  const service = res.app.locals.pAS[res.app.locals.chain.name]
  const crankcount = await service.getTodaysCranks()
  res.render('crankstats', {naked:true, crankcount})
}))

router.post('/lora', asyncHandler(async (req, res, next) => {
  console.log(req.query)
  console.log(req.body)
  res.json({})
}))



module.exports = router;