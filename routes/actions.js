const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler')
const config = require('../config');

router.get('/wallet', isLoggedIn, asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const userDetails = {}
    if (service.hasKey() === true) {
        userDetails.wallet = service.getWallet()
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
        userDetails.wallet = service.getWallet()
        userDetails.balance = await service.getBalance(userDetails.wallet, service.coinModule('KDA'))
        userDetails.crankkBalance = await service.getBalance(userDetails.wallet, service.coinModule('CRKK'))
        userDetails.fiatBalance = await service.getFiatBalance(userDetails.balance)
    }
    res.render('transfer', { category: 'Transfer', userDetails});
}))

router.get('/exchange', asyncHandler(async (req, res, next) => {
    const service = res.app.locals.pAS[res.app.locals.chain.name]
    const userDetails = {}
    if (service.hasKey() === true) {
        userDetails.wallet = service.getWallet()
        if (userDetails.wallet !== 'k:54057e541f3652e86530af9c46a04cf1ab216ea9866f5f31357f01d9a7d4d09d') return res.sendStatus(404);
        userDetails.balance = await service.getBalance(userDetails.wallet, service.coinModule('KDA'))
        userDetails.crankkBalance = await service.getBalance(userDetails.wallet, service.coinModule('CRKK'))
        userDetails.fiatBalance = await service.getFiatBalance(userDetails.balance)
    }
    const otherOffers = await service.getOtherOpenOffers()
    const offers = await service.getMyOpenOffers(otherOffers)
    const lastPrice = await service.getLastPrice('coin/free.crankk01')
    res.render('exchange',  {category: 'Exchange', userDetails, offers, otherOffers, lastPrice})
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

function isLoggedIn(req, res, next) {
    if (config.physical) next()
    else req.user ? next() : res.redirect('/login') //res.sendStatus(401)
}

module.exports = router;
