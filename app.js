var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const pactRadioService = require('./services/pactRadioService')
const chirpstackService = require('./services/chirpstackService')
const connectionService = require('./services/connectionService')
const config = require('./config')


var indexRouter = require('./routes/index');
var actionsRouter = require('./routes/actions');
var offlineRouter = require('./routes/offline');
const Pact = require("pact-lang-api");

var app = express();

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

  if (app.locals.pAS[activeChain.name]?.hasKey() === true) {
    const wallet = res.app.locals.pAS[activeChain.name].getWallet()
    const balance = await res.app.locals.pAS[activeChain.name].getBalance(wallet, 'coin')
    res.locals.txns = await res.app.locals.pAS[activeChain.name].getPending() || []
    res.locals.status.pending = res.locals.txns.length
    if (res.locals.status.pending === 0) res.locals.status.pending = ''

    if (balance === 0) {
      res.locals.status.color = 'danger'
      res.locals.status.message = 'Zero balance'
    } else {
      res.locals.status.color = 'success'
      res.locals.status.message = 'Online'
    }
    next();
  } else {
      if (req.url === '/actions/wallet' || req.url === '/actions/restore' || req.url === '/actions/reset' || req.url === '/home') {
        next();
      } else {
        res.render('passPhrase')
      }
  }

})

app.use('/', indexRouter);
app.use('/actions', actionsRouter);
app.use('/offline', offlineRouter);

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
  res.status(err.status || 500);
  res.render('error');
});

app.locals.pAS = {}
app.locals.connS = new connectionService()

setInterval(async ()=>{
  if (!app.locals.cS && app.locals.connS.isOnline()) { // && config.chirpstack.gatewayId.length > 0) { //if no service yet and is online
    app.locals.cS = new chirpstackService()
  }
  // if (app.locals.cS && !app.locals.connS.isOnline()) { //if service and offline, then stop service //this doesn't really work, GC doesn't seem to get rid of it
  //   delete app.locals.cS
  // }
  for (let i in config.chains) {
    const chain = config.chains[i]
    app.locals.chain = chain
    if (!app.locals.pAS[chain.name] && app.locals.connS.isOnline()) { //if no service yet an is online
      app.locals.pAS[chain.name] = new pactRadioService(chain, app.locals.cS)
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
