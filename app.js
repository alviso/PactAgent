var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const pactAgentService = require('./services/pactAgentService')
const pactRadioService = require('./services/pactRadioService')
const machineService = require('./services/machineService')
const chirpstackService = require('./services/chirpstackService')
const config = require('./config')
// const AutoGitUpdate = require('auto-git-update');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var actionsRouter = require('./routes/actions');

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

  if (app.locals.pAS[app.locals.chain.name].hasKey() === true) {
    const wallet = res.app.locals.pAS[app.locals.chain.name].getWallet()
    const balance = await res.app.locals.pAS[app.locals.chain.name].getBalance(wallet, 'coin')
    res.locals.txns = await res.app.locals.pAS[app.locals.chain.name].getPending()
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
      }
      else res.render('passPhrase')
  }

})

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/actions', actionsRouter);

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
app.locals.mS = new machineService()
app.locals.cS = new chirpstackService()

for (let i in config.chains) {
  const chain = config.chains[i]
  app.locals.chain = chain
  app.locals.pAS[chain.name] = new pactRadioService(chain, app.locals.cS) //new pactAgentService(chain)
}

// const updater = new AutoGitUpdate(config.autoUpdate);
// updater.autoUpdate();

module.exports = app;
