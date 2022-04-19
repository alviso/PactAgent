var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
// const pactAgentService = require('./services/pactAgentService')
// const machineService = require('./services/machineService')
// const AutoGitUpdate = require('auto-git-update');
const pactRadioService = require('./services/pactRadioService')
const chirpstackService = require('./services/chirpstackService')
const connectionService = require('./services/connectionService')
const config = require('./config')


var indexRouter = require('./routes/index');
var actionsRouter = require('./routes/actions');
var offlineRouter = require('./routes/offline');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(logger('dev'));

app.use(async function (req, res, next) {
  res.locals.status = {}
  res.locals.status.color = 'danger'
  res.locals.status.message = 'No key'

  res.locals.status.net = app.locals.chain.name + '/' + app.locals.chain.chainId
  res.locals.status.netcolor = app.locals.chain.color

  if (!app.locals.pAS[app.locals.chain.name]) {
    res.locals.status.color = 'primary'
    res.locals.status.message = 'Offline'
    const networks = await app.locals.connS.scan()
    res.render('connectivity', {category: 'Connectivity', networks})
  }

  if (app.locals.pAS[app.locals.chain.name]?.hasKey() === true) {
    const wallet = res.app.locals.pAS[app.locals.chain.name].getWallet()
    const balance = await res.app.locals.pAS[app.locals.chain.name].getBalance(wallet, 'coin')
    res.locals.txns = await res.app.locals.pAS[app.locals.chain.name].getPending() || []
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
// app.locals.mS = new machineService()
// app.locals.cS = new chirpstackService()
app.locals.connS = new connectionService()

for (let i in config.chains) {
  const chain = config.chains[i]
  app.locals.chain = chain
  // app.locals.pAS[chain.name] = new pactRadioService(chain, app.locals.cS) //new pactAgentService(chain)
}

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

// const updater = new AutoGitUpdate(config.autoUpdate);
// updater.autoUpdate();

module.exports = app;
