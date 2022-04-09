const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler')
const moment = require('moment')
const config = require('../config');

router.get('/wallet', asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const userDetails = {}
    if (service.hasKey() === true) {
        userDetails.wallet = await service.getWallet()
        userDetails.gatewayId = service.getGatewayId()
        userDetails.balance = await service.getBalance(userDetails.wallet, 'coin')
        userDetails.crankkBalance = await service.getBalance(userDetails.wallet, 'free.crankk01')
        userDetails.fiatBalance = await service.getFiatBalance(userDetails.balance)
    }
    res.render('wallet', { category: 'Wallet', userDetails});
}))

router.get('/transfer', asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const userDetails = {}
    if (service.hasKey() === true) {
        userDetails.wallet = await service.getPubKey()
        userDetails.balance = await service.getBalance(userDetails.wallet, 'coin')
        userDetails.crankkBalance = await service.getBalance(userDetails.wallet, 'free.crankk01')
        userDetails.fiatBalance = await service.getFiatBalance(userDetails.balance)
    }
    res.render('transfer', { category: 'Transfer', userDetails});
}))

router.get('/exchange', asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const userDetails = {}
    if (service.hasKey() === true) {
        userDetails.wallet = await service.getPubKey()
        userDetails.balance = await service.getBalance(userDetails.wallet, 'coin')
        userDetails.crankkBalance = await service.getBalance(userDetails.wallet, 'free.crankk01')
        userDetails.fiatBalance = await service.getFiatBalance(userDetails.balance)
    }
    const otherOffers = await service.getOtherOpenOffers()
    const offers = await service.getMyOpenOffers(otherOffers)
    const lastPrice = await service.getLastPrice('coin/free.crankk01')
    res.render('exchange',  {category: 'Exchange', userDetails, offers, otherOffers, lastPrice})
}))

router.get('/cycles', asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const cycles = await service.readCycles()
    res.json(cycles)
}))

router.post('/wallet', asyncHandler(async (req, res, next) => {
    for (let i in res.app.locals.pAS) {
        res.app.locals.pAS[i].setKey(req.body) //set key for all services
    }
    res.redirect('/')
}))

router.post('/addTxn', asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const {txn, type} = req.body
    await service.addTxn(txn, type)
    res.json({})
}))

router.get('/passPhrase', asyncHandler(async (req, res, next) => {
    res.render('passPhrase', { category: 'Passphrase'});
}))

router.get('/restore', asyncHandler(async (req, res, next) => {
    res.render('restore', { category: 'Restore wallet'});
}))

router.get('/switch', asyncHandler(async (req, res, next) => {
    for (let i in res.app.locals.pAS) {
        if (i !== res.app.locals.chain.name) {
            res.app.locals.chain = config.chains.find(e => e.name === i)
            break
        }
    }
    res.redirect('/')
}))

router.get('/reset', asyncHandler(async (req, res, next) => {
    res.render('reset', { category: 'Reset keys'});
}))

router.post('/reset', asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    service.resetKey()
    res.redirect('/')
}))

router.post('/transfer', asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const {toWallet, amount} = req.body
    await service.transfer(toWallet, amount)
    res.redirect('/')
}))

router.get('/balances', asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    let balances = await service.balances(req.query?.coin)
    balances = balances.reverse()
    let newBalances = []
    const cutoff = moment().subtract(14, 'd').format('YYYY-MM-DD')
    for (let i in balances) {
        const newBalance = {}
        newBalance.date = moment(balances[i].ts).format('YYYY-MM-DD')
        newBalance.value = balances[i].balance.toString()
        if (newBalances.filter(e => e.date === newBalance.date).length === 0) newBalances.push(newBalance)
    }
    for (let i = 0; i<14; i++) {
        const date = moment().subtract(i, 'days').format('YYYY-MM-DD')
        if (newBalances.filter(e => e.date === date).length === 0) newBalances.push({date, value:0})
    }
    newBalances = newBalances.filter(e => e.date >= cutoff)
    newBalances = newBalances.sort((a,b)=>(moment(b.date) - moment(a.date)))
    res.json(newBalances)
}))

router.get('/crankkprice', asyncHandler(async (req, res, next) => {
    const crankkprice = []
    const date = new Date()
    for (let i=0; i < 25; i++ ) {
        crankkprice.push({day:moment.utc(date).subtract(i+1, 'd').format("YYYY-MM-DD"), count:{int:0.1}})
    }
    res.json(crankkprice)
}))


module.exports = router;

// router.get('/nodestats', asyncHandler(async (req, res, next) => {
//     const service = res.app.locals.pAS[res.app.locals.chain.name]
// let nodestats = await service.getNodestats()
// nodestats.shift()
// const dailys = []
// for (let i in nodestats) {
//     dailys.push(nodestats[i].count.int)
// }
// if (dailys.length < 24){
//     for (let i=0; i < 24 - nodestats.length; i++ ) {
//         dailys.push(3)
//     }
// }
// dailys.reverse()
//     res.json({}) //dailys
// }))
