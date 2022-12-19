const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session')
const pactRadioService = require('./services/pactRadioService')
const chirpstackService = require('./services/chirpstackService')
const connectionService = require('./services/connectionService')
const config = require('./config')

const indexRouter = require('./routes/index');
const actionsRouter = require('./routes/actions');
const offlineRouter = require('./routes/offline');
const passport = require("passport");
require('./services/auth')
const fs = require("fs");

const app = express();
app.use(session({secret: 'horses'}))
app.use(passport.initialize())
app.use(passport.session())

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(logger('dev'));

app.use(async function (req, res, next) {
  res.locals.status = {}
  res.locals.status.color = 'danger'
  res.locals.status.message = 'No key'

  const activeChain = config.chains[config.chains.length - 1]
  res.locals.status.net = activeChain.name + '/' + activeChain.chainId
  res.locals.status.netcolor = activeChain.color

  if (config.website) {
    req.url = '/home'
  }

  if (!app.locals.connS.isOnline()) { //if offline
    res.locals.status.color = 'primary'
    res.locals.status.message = 'Offline'
    if (!req.url.startsWith('/offline')) { //redirect to connectivity if not in offline function
      req.url = '/offline'
    }
    return next();
  }

  if (!app.locals.cS) { //if no GW
    res.locals.status.gwcolor = 'danger'
    res.locals.status.gw = 'No GW'
  } else {
    res.locals.status.gwcolor = 'success'
    res.locals.status.gw = config.chirpstack.gatewayId
  }

  if (app.locals.pAS[activeChain.name]?.hasKey() === true) {
    const wallet = res.app.locals.pAS[activeChain.name].getWallet()
    const pw = res.app.locals.pAS[activeChain.name].hasPw()
    const owned = await res.app.locals.pAS[activeChain.name].getOwned()
    const balance = await res.app.locals.pAS[activeChain.name].getBalance(wallet, 'coin')
    res.locals.txns = await res.app.locals.pAS[activeChain.name].getPending() || []
    res.locals.status.pending = res.locals.txns.length
    if (res.locals.status.pending === 0) res.locals.status.pending = ''
    console.log(pw, owned)
    if (balance === 0) {
      res.locals.status.color = 'danger'
      res.locals.status.message = 'Zero balance'
    } else if (!owned) {
      res.locals.status.color = 'danger'
      res.locals.status.message = 'Need password'
    } else {
      res.locals.status.color = 'success'
      res.locals.status.message = 'Online'
    }
    next();
  } else if (!req.url.includes('auth')) {
      if (req.url === '/actions/wallet' || req.url === '/actions/restore' || req.url === '/actions/reset'
          || req.url === '/home' || req.url === '/login' || req.url === '/logout'
          || (req.url === '/' && !req.user) ) {
        next();
      } else {
        res.render('passPhrase')
      }
  } else {
    next();
  }


})

app.use('/', indexRouter);
app.use('/actions', actionsRouter);
app.use('/offline', offlineRouter);

app.get('/auth/google',
    passport.authenticate('google', {
      scope: ['profile', 'email']
    })
);

app.get('/auth/googleCallback',
    passport.authenticate('google', {
      successRedirect: '/',
      failureRedirect: '/login'
    })
)

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.sendStatus(err.status || 500);
  // res.render('error');
});

app.locals.pAS = {}
app.locals.connS = new connectionService()
console.log('Physical device:', config.physical)
let singleUserFile = '{"singleUser":""}'
try {
  singleUserFile = fs.readFileSync('./data/single_user.json', 'utf8')
} catch (e) {
  console.log('No single user conf found')
}
const singleUser = JSON.parse(singleUserFile)
let users = []
if (Array.isArray(singleUser)) {
  for (let item of singleUser) {
    users.push(item.singleUser)
  }
} else {
  users.push(singleUser.singleUser)
}

setInterval(async ()=>{
  if (!app.locals.cS && app.locals.connS.isOnline() && config.chirpstack.gatewayId.length > 0) { //if no service yet and is online
    app.locals.cS = new chirpstackService()
  }
  // if (app.locals.cS && !app.locals.connS.isOnline()) { //if service and offline, then stop service //this doesn't really work, GC doesn't seem to get rid of it
  //   delete app.locals.cS
  // }
  for (let i in config.chains) {
    const chain = config.chains[i]
    app.locals.chain = chain
    if (!app.locals.pAS[chain.name] && app.locals.connS.isOnline()) { //if no service yet an is online
      app.locals.pAS[chain.name] = new pactRadioService(chain, app.locals.cS, singleUser)
    }
    if (app.locals.pAS[chain.name] && app.locals.cS) {
      app.locals.pAS[chain.name].setCs(app.locals.cS)
    }
    // if (app.locals.pAS[chain.name] && !app.locals.connS.isOnline()) { ///if service and offline, then stop service //this doesn't really work, GC doesn't seem to get rid of it
    //   delete app.locals.pAS[chain.name]
    // }
  }

}, 10 * 1000); //check connectivity, start and stop services

process.stdin.resume();//so the program will not close instantly
function exitHandler(options, exitCode) {
  if (options.cleanup) {
    for (let i in config.chains) {
      const chain = config.chains[i]
      app.locals.pAS[chain.name]?.save()
      console.log(chain.name, 'save')
    }
  }
  if (exitCode || exitCode === 0) console.log(exitCode);
  if (options.exit) process.exit();
}
//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));
//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));
// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));
//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));

module.exports = app;

// const pactAgentService = require('./services/pactAgentService')
// const machineService = require('./services/machineService')
// const AutoGitUpdate = require('auto-git-update');
// const updater = new AutoGitUpdate(config.autoUpdate);
// updater.autoUpdate();
