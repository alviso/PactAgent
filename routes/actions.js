const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler')
const moment = require('moment')
const config = require('../config');

router.get('/wallet', isLoggedIn, asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const userDetails = {}
    if (service.hasKey() === true) {
        userDetails.wallet = await service.getWallet()
        userDetails.gatewayId = service.getGatewayId()
        userDetails.balance = await service.getBalance(userDetails.wallet, service.coinModule('KDA'))
        userDetails.crankkBalance = await service.getBalance(userDetails.wallet, service.coinModule('CRKK'))
        userDetails.fiatBalance = await service.getFiatBalance(userDetails.balance)
    }
    res.render('wallet', { category: 'Wallet', userDetails});
}))

router.get('/transfer', isLoggedIn, asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const userDetails = {}
    if (service.hasKey() === true) {
        userDetails.wallet = await service.getWallet()
        userDetails.balance = await service.getBalance(userDetails.wallet, service.coinModule('KDA'))
        userDetails.crankkBalance = await service.getBalance(userDetails.wallet, service.coinModule('CRKK'))
        userDetails.fiatBalance = await service.getFiatBalance(userDetails.balance)
    }
    res.render('transfer', { category: 'Transfer', userDetails});
}))

router.post('/wallet', isLoggedIn, asyncHandler(async (req, res, next) => {
    for (let i in res.app.locals.pAS) {
        res.app.locals.pAS[i].setKey(req.body) //set key for all services
    }
    res.redirect('/')
}))

router.get('/passPhrase', isLoggedIn, asyncHandler(async (req, res, next) => {
    res.render('passPhrase', { category: 'Passphrase'});
}))

router.get('/restore', isLoggedIn, asyncHandler(async (req, res, next) => {
    res.render('restore', { category: 'Restore wallet'});
}))

router.get('/reset', isLoggedIn, asyncHandler(async (req, res, next) => {
    res.render('reset', { category: 'Reset keys'});
}))

router.post('/reset', isLoggedIn, asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    service.resetKey()
    res.redirect('/')
}))

router.post('/setGwId', isLoggedIn, asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const {gatewayId, apikey} = req.body
    service.setGatewayId(gatewayId)
    service.setApikey(apikey)
    res.redirect('/')
}))

router.post('/setTrPw', isLoggedIn, asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const {transferPw} = req.body
    service.setTrPw(transferPw)
    res.redirect('/')
}))

router.post('/transfer', isLoggedIn, asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const {toWallet, amount} = req.body
    await service.transfer(toWallet, amount)
    res.redirect('/')
}))

// router.get('/balances', isLoggedIn, asyncHandler(async (req, res, next) => {
//     const service = res.app.locals.pAS[res.app.locals.chain.name]
//     let balances = await service.balances(req.query?.coin)
//     balances = balances.reverse()
//     let newBalances = []
//     const cutoff = moment().subtract(14, 'd').format('YYYY-MM-DD')
//     for (let i in balances) {
//         const newBalance = {}
//         newBalance.date = moment(balances[i].ts).format('YYYY-MM-DD')
//         newBalance.value = balances[i].balance.toString()
//         if (newBalances.filter(e => e.date === newBalance.date).length === 0) newBalances.push(newBalance)
//     }
//     for (let i = 0; i<14; i++) {
//         const date = moment().subtract(i, 'days').format('YYYY-MM-DD')
//         if (newBalances.filter(e => e.date === date).length === 0) newBalances.push({date, value:0})
//     }
//     newBalances = newBalances.filter(e => e.date >= cutoff)
//     newBalances = newBalances.sort((a,b)=>(moment(b.date) - moment(a.date)))
//     res.json(newBalances)
// }))

function isLoggedIn(req, res, next) {
    if (config.physical) next()
    else req.user ? next() : res.redirect('/login') //res.sendStatus(401)
}

module.exports = router;

// router.post('/addTxn', asyncHandler(async (req, res, next) => {
//     const service = res.app.locals.pAS[res.app.locals.chain.name]
//     const {txn, type} = req.body
//     await service.addTxn(txn, type)
//     res.json({})
// }))

// router.get('/crankkprice', asyncHandler(async (req, res, next) => {
//     const crankkprice = []
//     const date = new Date()
//     for (let i=0; i < 25; i++ ) {
//         crankkprice.push({day:moment.utc(date).subtract(i+1, 'd').format("YYYY-MM-DD"), count:{int:0.1}})
//     }
//     res.json(crankkprice)
// }))

// router.get('/switch', isLoggedIn, asyncHandler(async (req, res, next) => {
//     for (let i in res.app.locals.pAS) {
//         if (i !== res.app.locals.chain.name) {
//             res.app.locals.chain = config.chains.find(e => e.name === i)
//             break
//         }
//     }
//     res.redirect('/')
// }))
//

// router.get('/exchange', asyncHandler(async (req, res, next) => {
//     const service = res.app.locals.pAS[res.app.locals.chain.name]
//     const userDetails = {}
//     if (service.hasKey() === true) {
//         userDetails.wallet = await service.getPubKey()
//         userDetails.balance = await service.getBalance(userDetails.wallet, service.coinModule('KDA'))
//         userDetails.crankkBalance = await service.getBalance(userDetails.wallet, service.coinModule('CRKK'))
//         userDetails.fiatBalance = await service.getFiatBalance(userDetails.balance)
//     }
//     const otherOffers = await service.getOtherOpenOffers()
//     const offers = await service.getMyOpenOffers(otherOffers)
//     const lastPrice = await service.getLastPrice('coin/free.crankk01')
//     res.render('exchange',  {category: 'Exchange', userDetails, offers, otherOffers, lastPrice})
// }))

// router.get('/cycles', asyncHandler(async (req, res, next) => {
//     const service = res.app.locals.pAS[res.app.locals.chain.name]
//     const cycles = await service.readCycles()
//     res.json(cycles)
// }))
//

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
