const Pact = require("pact-lang-api");
const config = require("../config.js");
const runTasks = require("./runTasks.js");
const moment = require("moment")
const axios = require("axios")
const crypto = require("crypto");
const CryptoJS = require("crypto-js");
const Engine = require('tingodb')()


class pactAgentService {

    constructor(chain) {
        this.KP = {}
        this.wallet = ''
        this.chain = chain
        this.API_HOST = `https://${chain.host}/chainweb/0.0/${chain.networkId}/chain/${chain.chainId}/pact`
        this.secsBase = 600
        this.db = new Engine.Db('./data', {});
        if (chain.name === 'test') this.name = ''
        else this.name = chain.name
        this.balanceColl = this.db.collection("balance"+this.name)
        this.txnColl = this.db.collection("txns0"+this.name)
        this.asKey = this.db.collection("asimkey") //same for all
        this.price = 0
        setInterval(async ()=>{
            if (await this.goodToGo() === false) return
            if (await this.allowedToGo() !== 0) return
            const scripts = await this.getScripts()
            const tasks = await this.getActiveTasks()
            const aTasks = await this.getArbitrateTasks()
            const asKey = await this.getAsKey()

            //Decrypting results and calculating consensus
            if (asKey.length > 0) {
                const pubKey = asKey[0].pub
                const buff = new Buffer(pubKey)
                const base64data = buff.toString('base64')
                const arbiter = aTasks.filter(e => e.pubkey === base64data)
                for (let i in arbiter) {
                    const task = arbiter[i]
                    const script = scripts.find(e => e.scriptId === task.scriptId)
                    const executions = await this.getExecutionsForTask(script.pactModule, script.scriptId, task.taskId, task.runCount.int)
                    const results = []
                    for (let j in executions) {
                        const execution = executions[j]
                        const result = await this.decrypt(execution.result)
                        results.push(result)
                    }
                    const resultConsensus = this.mode(results)
                    await this.setConsensusResult(script.pactModule, script.scriptId, task.taskId, task.runCount.int, resultConsensus)
                }
            }

            //Cranks
            const cranks = await this.getCranks()
            for (let k in cranks) {
                const crank = cranks[k]
                try {
                    await this.crank(crank.pactModule)
                } catch (e) { console.log(this.chain.name, e)}
            }

            //Tasks
            for (let j in tasks) {
                const task = tasks[j]
                const net = moment(task.net.timep).valueOf()
                const now = Date.now()
                if (net > now) {
                    console.log(this.chain.name, task.taskId, Math.floor((net-now) / 1000), ' seconds to go')
                    continue
                }
                const script = scripts.find(e => e.scriptId === task.scriptId)
                try {
                    const taskContext = JSON.parse(task.input)
                    for (let i in taskContext) {
                        const param = taskContext[i]
                        const search = '${'+i+'}'
                        script.input = script.input.replace(search, param)
                    }
                    const scriptContext = JSON.parse(script.input)
                    const result = await runTasks[script.function](scriptContext) || ""
                    const encResult = this.encrypt(task.pubkey, result)
                    await this.createExecution(script.pactModule, script.scriptId, task.taskId, task.runCount.int, encResult)
                } catch (e) { console.log(this.chain.name, e)}
            }
        }, 90 * 1000)

        setTimeout(this.reactivation, 60 * 1000)

        setInterval(async ()=>{
            if (await this.goodToGo() === false) return
            this.txnColl.find({ }).toArray(async (err, txns) => { //"result" : { "$exists" : false }
                for (let i in txns) {
                    const txn = txns[i].txn
                    const tsf = Date.now()
                    const elapsedSec = (tsf - txns[i]?.tsc) / 1000
                    const resp = await Pact.fetch.poll({requestKeys: [txn]}, this.API_HOST)
                    if (!resp[txn]) {
                        console.log(this.chain.name, 'Pending txn:', txn)
                        if (elapsedSec > 300) this.txnColl.remove({"txn": txn})
                        continue
                    }
                    console.log(this.chain.name, resp[txn].result, elapsedSec)
                    this.txnColl.remove({"txn": txn}) // this.txnColl.update({"txn": txn}, { $set: {"result": resp[txn].result, tsf}})
                }
            } )
        }, 10 * 1000);

        setInterval(async ()=>{
            if (await this.goodToGo() === false) return
            const now = Date.now()
            this.balanceColl.find({}).toArray(async (err, balances) => {
                for (let i in config.coinLookup) {
                    const coin = config.coinLookup[i].module
                    const coinBalances = balances.filter(e => e.coin === coin)
                    const oldBalance = coinBalances[coinBalances.length - 1]?.balance || 0
                    const balance = this.round(await this.getBalance(this.wallet, coin), 3)
                    if (balance !== oldBalance) {
                        this.balanceColl.insert({coin, ts:now, balance})
                    }
                }
             } )
        }, 60 * 1000);

    }

    mode(arr){
        return arr.sort((a,b) =>
            arr.filter(v => v===a).length
            - arr.filter(v => v===b).length
        ).pop();
    }

    reactivation = async () => {
        const secs = this.secsBase + Math.floor((Math.random() * 120))
        setTimeout(this.reactivation, secs * 1000)
        this.price = await this.getKDAUSD()
        if (await this.goodToGo() === false) return
        if (await this.allowedToGo() !== 0) return
        await this.reactivateNode()
        if ((await this.getAsKey()).length === 0) await this.setAsKey()
    }

    encrypt(pubkey, payload) {
        let buff = new Buffer(pubkey, 'base64');
        const publicKeyStr = buff.toString('ascii');
        const publicKey = crypto.createPublicKey(publicKeyStr)
        const symKey = crypto.randomBytes(16).toString('hex');
        const encryptedData = CryptoJS.AES.encrypt(payload, symKey).toString()
        const encryptedSymKey = crypto.publicEncrypt(
            {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256",
            },
            // We convert the data string to a buffer using `Buffer.from`
            Buffer.from(symKey)
        );
        const ret = encryptedData + ';;;;;' + encryptedSymKey.toString("base64")
        console.log(ret)
        return ret

    }

    async decrypt(result) {
        if (!result.includes(';;;;;')) {
            return result
        } else {
            const encryptedData = result.split(';;;;;')[0]
            const encryptedSymKey64 = result.split(';;;;;')[1]
            const encryptedSymKey = Buffer.from(encryptedSymKey64, "base64");
            const asKey = await this.getAsKey()
            const symKeyHex = crypto.privateDecrypt(
                {
                    key: asKey[0].priv,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: "sha256",
                },
                encryptedSymKey
            );
            const symKey = symKeyHex.toString()
            // const symKey = Buffer.from(symKeyHexStr, "hex");
            console.log(symKey)
            const decryptedData = CryptoJS.AES.decrypt(encryptedData, symKey).toString(CryptoJS.enc.Utf8)
            return decryptedData
        }
    }

    async allowedToGo() {
        return new Promise((resolve, reject)=>{
            this.txnColl.find({ "result" : { "$exists" : false } }).toArray(async (err, txns) => {
                console.log(this.chain.name, txns.length)
                resolve(txns.length)
            })
        })
    }

    async getPending() {
        return new Promise((resolve, reject)=>{
            this.txnColl.find({ "result" : { "$exists" : false } }).toArray(async (err, txns) => {
                for (let i in txns) {
                    txns[i].ago = moment(txns[i].tsc).fromNow()
                }
                resolve(txns)
            })
        })
    }

    async getAsKey() {
        return new Promise((resolve, reject)=>{
            this.asKey.find({}).toArray(async (err, key) => {
                resolve(key)
            })
        })
    }

    async balances(coin) {
        return new Promise((resolve, reject)=>{
            this.balanceColl.find({ coin: coin}).toArray(async (err, balances) => {
                resolve(balances)
            })
        })
    }

    async goodToGo() {
        //Not initialized
        if (!this.KP.publicKey) {
            // console.log(this.chain.name, 'Wallet not set!')
            return false
        }
        //Zero balance
        const balance = await this.getBalance(this.wallet, 'coin')
        if (balance === 0) {
            console.log(this.chain.name, 'Zero balance!')
            return false
        }
        // const result = await this.getBalance(this.KP.publicKey, 'free.crankk01')
        return true
    }

    hasKey() {
        if (this.KP?.publicKey) return true
        else return false
    }

    setKey(KP) {
        this.KP.publicKey = KP.publicKey
        this.KP.secretKey = KP.secretKey
        this.wallet = 'k:'+this.KP.publicKey
    }

    resetKey() {
        this.KP = {}
        this.wallet = ''
    }

    getPubKey() {
        return this.KP.publicKey
    }

    getWallet() {
        return this.wallet
    }

    async transfer(toWallet, amount) {
        const floatAmount = parseFloat(amount)
        const caps = [
            {
                "args":[],
                "name":"coin.GAS"
            },
            {
                "args":[this.wallet, toWallet, floatAmount],
                "name":"coin.TRANSFER"
            }
        ]
        const envData = {
            keyset: {
                pred: "keys-all",
                keys: [toWallet.replace('k:','')]
            }
        }
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`coin.transfer-create  \"${this.wallet}\" \"${toWallet}\" (read-keyset "keyset") ${floatAmount}`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
            envData
        };
        cmdObj.keyPairs.clist = caps

        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        console.log(this.chain.name, 'Start transfer: ', resp)
        if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], 'Start transfer')
        return resp || {}
    }


    makeCmdObj(func) {
        const envData = {
            keyset: {
                pred: "keys-all",
                keys: [this.KP.publicKey]
            }
        }
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${config.kadena.agentModule}.${func}`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
            envData
        };
        return cmdObj
    }

    makeExcObj(func) {
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${config.kadena.exchModule}.${func}`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
        };
        return cmdObj
    }

    async getActiveModules() {
        const cmdObj = this.makeCmdObj('get-activeModules')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        const modules = resp.result?.data || []
        this.timeToAgoModules(modules)
        return modules
    }

    async getMyOpenOffers(otherOpenOffers) {
        const cmdObj = this.makeExcObj('get-my-open-offers')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        const offers = resp.result?.data || []
        this.decorateOffers(offers)
        for (let i in offers) {
            const matches = otherOpenOffers.filter(e => (1 / e.rate) >= offers[i].rate && e.token0 === offers[i].token1 && e.token1 === offers[i].token0)
            const sum = matches.reduce((p,e) => p + e.amount1, 0)
            offers[i].matches = matches
            if (offers[i].matches.length > 0) {
                offers[i].key1 = offers[i].matches[0].key
                if (sum >= offers[i].amount0) {
                    offers[i].color = 'success'
                    offers[i].status = 'Fully tradable'
                } else {
                    offers[i].color = 'primary'
                    offers[i].status = 'Partially tradable'
                }
            }
            else {
                offers[i].color = 'danger'
                offers[i].status = 'No match'
            }

        }
        return offers
    }

    decorateOffers(offers) {
        for (let i in offers) {
            offers[i].amount0 = offers[i].ramount
            offers[i].amount1 = this.round(offers[i].ramount * offers[i].rate, 3)
            offers[i].token0 = this.getFullName(offers[i].token0).name
            offers[i].display0 = this.coinLookup(offers[i].token0, offers[i].amount0)
            offers[i].token1 = this.getFullName(offers[i].token1).name
            offers[i].display1 = this.coinLookup(offers[i].token1, offers[i].amount1)
            offers[i].display2 = this.usdLookup(offers[i])
            const unix = moment(offers[i].createdAt.timep).unix()
            const validitySeconds = offers[i].validityMinutes.int * 60
            const ts = (unix + validitySeconds) * 1000
            offers[i].validUntil = moment(ts).fromNow()
            offers[i].key = offers[i].offeror + '/' + offers[i].token0 + '/' + offers[i].token1 + '/' + offers[i].createdAt.timep.split('.')[0]
        }
    }

    usdLookup (offer) {
        if (offer.token0 === 'coin') return '' + this.round(offer.amount0 * this.price, 3) + ' USD'
        else if (offer.token1 === 'coin') return '' + this.round(offer.amount1 * this.price,3) + ' USD'
        else return '0 USD'
    }

    coinLookup (module, amount) {
        const coin = config.coinLookup.find(e => e.module === module).coin
        return '' + amount + ' ' + coin
    }

    round(value, decimals) {
        const num = Number(Math.round(value+'e'+decimals)+'e-'+decimals);
        const str = '' + num
        const int = str.split('.')[0]
        const dec = str.split('.')[1] || ''
        return int+'.'+dec.padEnd(decimals, '0')
    }

    async getOtherOpenOffers() {
        const cmdObj = this.makeExcObj('get-other-open-offers')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        const offers = resp.result?.data || []
        this.decorateOffers(offers)
        return offers
    }

    getFullName (token) {
        if (token.refName.namespace) token.name =token.refName.namespace + '.' + token.refName.name
        else token.name = token.refName.name
        return token
    }

    async getActiveNodes() {
        const cmdObj = this.makeCmdObj('get-activeNodes')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        const nodes = resp.result?.data || []
        this.timeToAgoNodes(nodes)
        return nodes
    }

    async getLastPrice(pair) {
        const cmdObj = this.makeExcObj('get-ledger')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        const ledger = resp.result?.data || []
        const lastPrice = this.lastPrice(ledger, pair)
        return lastPrice
    }

    lastPrice(ledger, pair) {
        const token0 = pair.split('/')[0]
        const token1 = pair.split('/')[1]
        ledger = ledger.sort((a,b) => (moment(b.eventAt.timep) - moment(a.eventAt.timep)))
        const last = ledger[0]
        if (this.getFullName(last.tokenA) === token0)
            return this.round(last.effrate, 3)
        else
            return this.round(1 / last.effrate, 3)
    }

    async getTodaysCranks() {
        const cmdObj = this.makeCmdObj('get-todays-cranks')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        const crankcount = resp.result?.data || "0"
        return crankcount
    }

    async getScripts() {
        const cmdObj = this.makeCmdObj('get-scripts')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        return resp.result?.data || {}
    }

    async getCranks() {
        const cmdObj = this.makeCmdObj('get-cranks')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        return resp.result?.data || {}
    }

    async callPactFunc(pactFunc) {
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${pactFunc}`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
        };

        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        return resp.result?.data || {}
    }

    async getNodestats() {
        const cmdObj = this.makeCmdObj('get-nodestats')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        let nodestats = resp.result?.data || []
        nodestats = nodestats.sort((a, b) => (moment(b.day).unix() - moment(a.day).unix()))
        // console.log(nodestats)
        return nodestats
    }

    async getCrankstats() {
        const cmdObj = this.makeCmdObj('get-crankstats')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        let crankstats = resp.result?.data || []
        crankstats = crankstats.sort((a, b) => (moment(b.day).unix() - moment(a.day).unix()))
        // console.log(crankstats)
        return crankstats
    }

    async getActiveTasks() {
        const cmdObj = this.makeCmdObj('get-activeTasks')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        return resp.result?.data || {}
    }

    async getArbitrateTasks() {
        const cmdObj = this.makeCmdObj('get-arbitrateTasks')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        return resp.result?.data || []
    }

    async getTasks() {
        const cmdObj = this.makeCmdObj('get-tasks')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        let tasks = resp.result?.data || []
        tasks = tasks.sort((a, b) => (moment(b.createdAt.timep).unix() - moment(a.createdAt.timep).unix()))
        this.timeToAgoTasks(tasks)
        return tasks
    }

    async addTxn(txn, type) {
        this.txnColl.insert({txn, type, tsc:Date.now()})
    }

    async showMsg() {
        // const cmdObj = this.makeCmdObj('show-msg')
        // const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        // let msg = resp.result
        // console.log(msg)
        return
    }

    async getExecutions() {
        const cmdObj = this.makeCmdObj('get-executions')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        let execs = resp.result?.data || []
        execs = execs.sort((a, b) => (moment(b.createdAt.timep).unix() - moment(a.createdAt.timep).unix()))
        this.timeToAgoExecs(execs)
        return execs
    }

    async createExecution(pactModule, scriptId, taskId, runCount, result) {
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${config.kadena.agentModule}.create-execution \"${pactModule}\" \"${scriptId}\" \"${taskId}\" \"${runCount}\" \"${result}\"`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
        };

        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        console.log(this.chain.name, 'Create execution: ', resp)
        if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], 'Create execution')
        return resp || {}

    }

    async setConsensusResult(pactModule, scriptId, taskId, runCount, resultConsensus) {
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${config.kadena.agentModule}.set-consensus-result \"${pactModule}\" \"${scriptId}\" \"${taskId}\" \"${runCount}\" \"${resultConsensus}\"`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
        };

        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        console.log(this.chain.name, 'Set consensus result: ', resp)
        if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], 'Set consensus result')
        return resp || {}

    }

    async getExecutionsForTask(pactModule, scriptId, taskId, runCount) {
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${config.kadena.agentModule}.get-executions-for-task \"${pactModule}\" \"${scriptId}\" \"${taskId}\" \"${runCount}\"`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
        };

        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        return resp.result?.data || []
    }

    async reactivateNode() {
        const cmdObj = this.makeCmdObj('reactivate-node')
        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        console.log(this.chain.name, 'Reactivate node: ',resp)
        if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], 'Reactivate node')
        return resp || {}
    }

    async setAsKey() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
            // The standard secure default length for RSA keys is 2048 bits
            modulusLength: 1024,
        });
        const asPubKey = publicKey.export({
                type: "pkcs1",
                format: "pem",
            })
        const buff = new Buffer(asPubKey)
        const base64data = buff.toString('base64')
        const asPrivKey = privateKey.export({
                type: "pkcs1",
                format: "pem",
            })
        await this.asKey.insert({pub:asPubKey, priv:asPrivKey})

        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${config.kadena.agentModule}.set-my-pubkey \"${base64data}\"`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
        };
        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        console.log(this.chain.name, 'Set asPubKey: ',resp)
        if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], 'Set asPubKey')
        return resp || {}
    }

    async crank(module) {
        const envData = {
            keyset: {
                pred: "keys-all",
                keys: [this.KP.publicKey]
            }
        }
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${module}.crank`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
            envData
        };

        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        console.log(this.chain.name, 'Crank: ', module, '-',resp)
        if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], 'Call crank')
        return resp || {}

    }

    async getBalances() {
        const kda = this.round(await this.getBalance(this.wallet,'coin'), 3)
        const crkk = this.round(await this.getBalance(this.wallet,'free.crankk01'), 3)
        const usd = await this.getFiatBalance(kda)
        return {kda, crkk, usd}
    }

    async getBalance(wallet, coin) {
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${coin}.details \"${wallet}\"`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
        };

        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        if (resp.result?.status === 'failure' && coin === 'free.crankk01') {
            // console.log('No CRANKK account!')
            // await this.createCrankkAccount(this.KP.publicKey)
        }
        return resp.result?.data?.balance || 0
    }

    makeMeta() {
        return Pact.lang.mkMeta(
            this.wallet,
            this.chain.chainId,
            config.kadena.gasPrice,
            config.kadena.gasLimit,
            this.creationTime(),
            config.kadena.ttl
        )
    }

    creationTime() {
        return Math.round(new Date().getTime() / 1000) - 15
    }

    async getFiatBalance(balance) {
        const response = await axios.get(config.kucoin.exchangeRateUrl)
        return Math.round(balance * parseFloat(response.data.data[0].lastTradedPrice) * 100) / 100
    }

    async getKDAUSD() {
        const response = await axios.get(config.kucoin.exchangeRateUrl)
        return Math.round(parseFloat(response.data.data[0].lastTradedPrice) * 100) / 100
    }

    timeToAgoNodes(nodes) {
        for (let i in nodes) {
            nodes[i].lastAction.timep = moment(nodes[i].lastAction.timep).fromNow()
        }
    }

    timeToAgoModules(modules) {
        for (let i in modules) {
            modules[i].net.timep = moment(modules[i].net.timep).fromNow()
        }
    }

     timeToAgoTasks(tasks) {
        for (let i in tasks) {
            tasks[i].net.timep = moment(tasks[i].net.timep).fromNow()
        }
    }

    timeToAgoExecs(execs) {
        for (let i in execs) {
            execs[i].createdAt.timep = moment(execs[i].createdAt.timep).fromNow()
            if (execs[i].result.includes(';;;;;')) execs[i].result = '-Encrypted-'
        }
    }

}



module.exports = pactAgentService


