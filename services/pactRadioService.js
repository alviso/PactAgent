const Pact = require("pact-lang-api");
const config = require("../config.js");
const moment = require("moment")
const axios = require("axios")
const crypto = require("crypto");
const CryptoJS = require("crypto-js");
const Engine = require('tingodb')()
const fs = require('fs');

class pactRadioService {

    constructor(chain, cS) {
        this.KP = {}
        this.haveANode = false
        this.wallet = ''
        this.transferPw = ''
        this.nodes = []
        this.gatewayGPSCache = {}
        let KPString = "{}"
        try {
            KPString = fs.readFileSync('./data/tmpkp.json',{encoding: "utf8"})
            fs.unlinkSync('./data/tmpkp.json')
        } catch (e) { }
        this.setKey(JSON.parse(KPString))
        this.chain = chain
        this.consMember = false
        this.cS = cS
        this.API_HOST1 = `https://${chain.host}/chainweb/0.0/${chain.networkId}/chain/${chain.chainId}/pact`
        this.API_HOST2 = `https://${chain.host2}/chainweb/0.0/${chain.networkId}/chain/${chain.chainId}/pact`
        this.API_HOST = this.API_HOST1
        this.db = new Engine.Db('./data', {});
        if (chain.name === 'test') this.name = ''
        else this.name = chain.name
        this.balanceColl = this.db.collection("balance"+this.name)
        this.txnColl = this.db.collection("txns0"+this.name)
        this.asKey = this.db.collection("asimkey") //same for all
        this.cyclesColl = this.db.collection("cycles0"+this.name)
        this.nodesColl = this.db.collection("nodes"+this.name)
        this.allCyclesColl = this.db.collection("allcycles"+this.name)
        this.countColl = this.db.collection("count1"+this.name)
        this.price = 0
        this.asKeyManage()

        setInterval(async ()=>{
            if (await this.goodToGo() === false) return  //nothing happens if low KDA balance
            this.txnColl.find({ }).toArray(async (err, txns) => {
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
                    this.txnColl.remove({"txn": txn})
                }
            } )

            if (await this.allowedToGo() !== 0) return
            if (this.cS) await this.checkMyNode()


        }, 10 * 1000); //pending transactions, node check, insert

        setInterval(async ()=>{
            if (await this.goodToGo() === false) return
            const now = Date.now()
            this.balanceColl.find({}).toArray(async (err, balances) => {
                if (err) return
                for (let i in config.coinLookup) {
                    const coin = config.coinLookup[i].module
                    const coinBalances = balances.filter(e => e.coin === coin)
                    const oldBalance = coinBalances[coinBalances.length - 1]?.balance || 0
                    const balance = this.round(await this.getBalance(this.wallet, coin), 3)
                    if (balance !== oldBalance) {
                        if (coin.includes('crankk')) {
                            const cycles = await this.readCycles()
                            let lastCycle = cycles[1]
                            if (!lastCycle || lastCycle.award) { //if this is not a good candidate
                                lastCycle = cycles[0]
                            }
                            if (lastCycle && !lastCycle.award) {
                                lastCycle.award = balance - oldBalance
                                this.cyclesColl.update({"ts" : lastCycle.ts},
                                    {$set: { "award" : lastCycle.award}})
                            }
                        }
                        this.balanceColl.insert({coin, ts:now, balance})
                        this.balanceColl.remove({'ts': {$lt: now - 21 * 24 * 60 * 60 * 1000}})
                    }
                }
            } )
        }, 60 * 1000); //balance update, received award update,

        setInterval(async ()=>{
            if (await this.goodToGo() === false) return
            if (await this.allowedToGo() !== 0) return
            if (this.consMember === false) return
            const nodes = await this.pactCall('L', 'free.radio02.get-nodes')
            const directableNodes = nodes.filter(e => e.send === false && e.sent.length === 0 && moment(e.net.timep).unix() < moment().unix())
            const len = directableNodes.length
            if (len > 0) {
                const ind = Math.floor(Math.random() * len)
                const sel = directableNodes[ind]
                await this.pactCall('S', 'free.radio02.direct-to-send', sel.address)
            }
            //this is seconds, let it be 5 min old to not miss receive updates
            const checkableNodes = nodes.filter(e => e.send === false && e.sent.length > 0 && (moment(e.lastAction.timep).unix() + 300) < moment().unix())
            const asKey = await this.getAsKeyDB()
            for (let i in checkableNodes) {
                const sendNode = checkableNodes[i]
                sendNode.gps = await this.cS.getGatewayGPS(sendNode.gatewayId)
                const sent = this.decrypt(asKey[0].priv, sendNode.sent)
                const resp = await this.pactCall('L', 'free.radio02.get-gateway', sendNode.gatewayId)
                const receives = JSON.parse(resp.replaceAll('} {','},{')) || []
                for (let j in receives) {
                    receives[j].mic = this.decrypt(asKey[0].priv, receives[j].mic)
                }
                //Analyze and reward here
                const validReceives = receives.filter(e => e.mic === sent)
                const unique = [...new Map(validReceives.map(item => [item['address'], item])).values()]
                const gateways = []
                for (let j in unique) {
                    const node = nodes.find(e => e.address === unique[j].address)
                    if (!node) continue
                    node.gps = await this.cS.getGatewayGPS(node.gatewayId)
                    const distance = this.calcCrow(node.gps.latitude, node.gps.longitude, sendNode.gps.latitude, sendNode.gps.longitude)
                    gateways.push(JSON.stringify({id:node.gatewayId, distance}))
                }
                await this.pactCall('S', 'free.radio02.close-send-receive', sendNode.address, unique, gateways)
                console.log(sent, receives)
            }

        }, 5 * 60 * 1000); //Arbitration, award

        setInterval(async ()=>{
            if (!config.website) return
            if (await this.goodToGo() === false) return
            if (await this.allowedToGo() !== 0) return
            const nodes = await this.pactCall('L', 'free.radio02.get-nodes')
            if (nodes.length === 0) return
            for (let i in nodes) {
                const nodeFromChain = nodes[i]
                if (nodeFromChain.sent.length === 0) {
                    nodeFromChain.gps =this.gatewayGPSCache[nodeFromChain.gatewayId] = await this.cS.getGatewayGPS(nodeFromChain.gatewayId)
                    const nodeStored = this.nodes.find(e => e.address === nodeFromChain.address)
                    if (nodeStored?.sent.length > 0) {
                        const validReceives = []
                        for (let j in nodeFromChain.validReceives) {
                            const receive = JSON.parse(nodeFromChain.validReceives[j])
                            receive.gps = this.gatewayGPSCache[receive.id] = await this.cS.getGatewayGPS(receive.id)
                            validReceives.push(receive)
                        }
                        const cycle = {senderGatewayId: nodeFromChain.gatewayId, senderGps: nodeFromChain.gps, validReceives, ts:Date.now()}
                        console.log('Send-receive closed:', cycle)
                        await this.allCyclesColl.insert(cycle)
                        await this.allCyclesColl.remove({'ts': {$exists: false}})
                        await this.allCyclesColl.remove({'ts': {$lt: Date.now() - 24 * 60 * 60 * 1000}})
                        let count = await this.getCount('allCycles')
                        await this.countColl.update({name: 'allCycles'},
                            {$set: {count: ++count}, $setOnInsert: {count: 500}},
                            {upsert: true})
                    }
                }
            }
            this.nodes = nodes
        }, 60 * 1000); //Statistics for website
    }

    async allowedToGo() {
        return new Promise((resolve, reject)=>{
            this.txnColl.find({ "result" : { "$exists" : false } }).toArray(async (err, txns) => {
                if (err) return resolve(0)
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

    async getStoredNodes() {
        return new Promise((resolve, reject)=>{
            this.nodesColl.find({ }).toArray(async (err, nodes) => {
                resolve(nodes)
            })
        })
    }

    async getAllCycles() {
        return new Promise((resolve, reject)=>{
            this.allCyclesColl.find({ }).toArray(async (err, cycles) => {
                resolve(cycles)
            })
        })
    }

    async getLastCycle() {
        const allCycles = await this.getAllCycles()
        let lastCycle = {}
        if (allCycles.length > 0) {
            lastCycle = allCycles[allCycles.length - 1]
            lastCycle.ago = moment(lastCycle.ts).fromNow()
        }
        return lastCycle
    }


    async getCount(name) {
        return new Promise((resolve, reject)=>{
            this.countColl.find({"name" : name}).toArray(async (err, count) => {
                resolve(count[0]?.count || 0)
            })
        })
    }

    async getMyCoord() {
        const myCoord = await this.cS?.getGatewayGPS(config.chirpstack.gatewayId) || {}
        if (myCoord?.latitude) myCoord.valid = true
        else myCoord.valid = false
        return myCoord
    }

    async goodToGo() {
        //Not initialized
        if (!this.KP.publicKey) {
            // console.log(this.chain.name, 'Wallet not set!')
            return false
        }
        //Low balance
        const balance = await this.getBalance(this.wallet, 'coin')
        if (balance < 0.015) {
            console.log(this.chain.name, 'Low balance!')
            return false
        }
        return true
    }

    async checkMyNode() {
        const myNode = await this.pactCall('L', 'free.radio02.get-my-node')
        if (!myNode?.address && !this.haveANode) {
            if (await this.getPreowned()) { //If preowned need pw
                if (this.transferPw.length > 0) { //only call if have pw
                    console.log('Transferring: ', config.chirpstack.gatewayId, 'with pw:', this.transferPw)
                    await this.pactCall('S', 'free.radio02.insert-my-node-with-transfer', config.chirpstack.gatewayId, this.transferPw)
                    this.haveANode = true
                    this.transferPw = '' //not needed any longer
                }
            } else {
                await this.pactCall('S', 'free.radio02.insert-my-node', config.chirpstack.gatewayId)
                this.haveANode = true
            }
        } else {
            if (!myNode.pubkey && (await this.allowedToGo()) === 0) {
                const asKey = await this.getAsKeyDB()
                const buff = new Buffer(asKey[0].pub)
                const base64data = buff.toString('base64')
                await this.pactCall('S', 'free.radio02.set-my-pubkey', base64data)
            }
            this.consMember = myNode.consMember
            if (myNode.send === true) {
                const MIC = await this.cS.sendPing()
                console.log(MIC)
                if (MIC.length > 0) {
                    const result = this.encrypt(myNode.pubkeyd, MIC) //encrypt mic with director's public key
                    await this.pactCall('S', 'free.radio02.update-sent', result)
                    this.cyclesColl.insert({event:'send', mic:MIC, ts:Date.now()})
                }
            }
            const recs = this.cS.getRecs()
            recs.forEach(rec => {
                console.log(rec)
                const result = this.encrypt(myNode.pubkeyd, rec.mic) //encrypt rec.mic with director's public key
                this.pactCall('S', 'free.radio02.add-received', rec.gatewayId, result)
                this.cyclesColl.insert({event:'receive', gatewayId:rec.gatewayId, mic:rec.mic, ts:Date.now()})
            })
            this.cS.rmRecs()

            const cycles = await this.readSendCycles()
            const lastCycle = cycles[0] || {}
            if (lastCycle.event === 'send' && (!lastCycle.validReceives || lastCycle.validReceives.length === 0)) {
                this.cyclesColl.update({"ts" : lastCycle.ts},
                    {$set: { "validReceives" : myNode.validReceives}})
            }
        }
    }

    async pactCall(mode, module) {
        const envData = {
            keyset: {
                pred: "keys-all",
                keys: [this.KP.publicKey]
            }
        }
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${module}`).slice(0, -2),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
            envData
        };
        for (let i in arguments) {
            if (i < 2) continue
            if (typeof arguments[i] === 'object') {
                const obj = JSON.stringify(arguments[i])
                cmdObj.pactCode += ' ' + `${obj}`
            }
            else cmdObj.pactCode += ' ' + `\"${arguments[i]}\"`
        }
        cmdObj.pactCode += ' )'
        if (mode === 'L') {
            cmdObj.meta.gasLimit = cmdObj.meta.gasLimit * 20
            try {
                const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
                return resp.result?.data || {}
            } catch (e) {
                return {}
            }
        } else {
            const lresp = await Pact.fetch.local(cmdObj, this.API_HOST)
            // console.log(this.chain.name, module, lresp)
            const ncmdObj = this.clone(cmdObj)
            if (lresp?.gas) {
                ncmdObj.meta.gasLimit = lresp.gas + 400
                //not willing to pay more than x then put a limit here and return {}
                console.log('Gas corrected!')
            }
            try {
                const resp = await Pact.fetch.send(ncmdObj, this.API_HOST)
                console.log(this.chain.name, moment().format(), module, resp)
                if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], module, ncmdObj)
                return resp || {}
            } catch (e) {
                return {}
            }
        }
    }

    async getNumberOfGateways() {
        const gwKeys = await this.pactCall('L', 'free.radio02.get-gateways-keys')
        return gwKeys.length
    }

    async getPreowned() {
        const gwDetails = await this.pactCall('L', 'free.radio02.get-gateway-details', config.chirpstack.gatewayId)
        if (gwDetails?.address && gwDetails.address !== 'k:'+this.KP.publicKey) return true
        else return false
    }

    async getBalances() {
        const kda = this.round(await this.getBalance(this.wallet,this.coinModule('KDA')), 3)
        const crkk = this.round(await this.getBalance(this.wallet,this.coinModule('CRKK')), 3)
        const usd = await this.getFiatBalance(kda)
        return {kda, crkk, usd}
    }

    async getDistributedCRKK() {
        const radioBankBalance = this.round(await this.getBalance(config.kadena.radioBank, this.coinModule('CRKK')), 2)
        return Math.round((10000 - radioBankBalance) * 100) / 100
    }

    async getBalance(wallet, coin) {
        const data = await this.pactCall('L', `${coin}.details`, wallet)
        if (!data?.balance) {
            console.log('Host toggle...')
            if (this.API_HOST === this.API_HOST1) this.API_HOST = this.API_HOST2
            else this.API_HOST = this.API_HOST1
        }
        return data?.balance || 0
    }

    async getFiatBalance(balance) {
        const response = await axios.get(config.kucoin.exchangeRateUrl)
        return Math.round(balance * parseFloat(response.data.data[0].lastTradedPrice) * 100) / 100
    }

    async balances(coin) {
        return new Promise((resolve, reject)=>{
            this.balanceColl.find({ coin: coin}).toArray(async (err, balances) => {
                resolve(balances)
            })
        })
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
                "name":"free.crankk01.TRANSFER"
            }
        ]
        const envData = {
            keyset: {
                pred: "keys-all",
                keys: [toWallet.replace('k:','')]
            }
        }
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`free.crankk01.transfer-create  \"${this.wallet}\" \"${toWallet}\" (read-keyset "keyset") ${floatAmount}`),
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

    getGatewayId() {
        return config.chirpstack.gatewayId
    }

    setGatewayId(gatewayId) {
        config.chirpstack.gatewayId = gatewayId
        const gateway_conf = {gateway_ID: gatewayId}
        const file = JSON.stringify({gateway_conf})
        fs.writeFileSync("./data/local_conf.json", file);
    }

    setTrPw(transferPw) {
        this.transferPw = transferPw
    }

    setCs(cs) {
        this.cS = cs
    }

    setApikey(apikey) {
        config.chirpstack.apiKey = apikey
        fs.writeFileSync("./data/apikey.json", JSON.stringify({apikey}));
    }

    async addTxn(txn, type) {
        this.txnColl.insert({txn, type, tsc:Date.now()})
    }

    creationTime() {
        return Math.round(new Date().getTime() / 1000) - 15
    }

    timeToAgoNodes(nodes) {
        for (let i in nodes) {
            nodes[i].lastAction.timep = moment(nodes[i].lastAction.timep).fromNow()
        }
    }

    round(value, decimals) {
        if (isNaN(value)) return value
        const num = Number(Math.round(value+'e'+decimals)+'e-'+decimals);
        const str = '' + num
        const int = str.split('.')[0]
        const dec = str.split('.')[1] || ''
        return int+'.'+dec.padEnd(decimals, '0')
    }

    mode(arr){
        return arr.sort((a,b) =>
            arr.filter(v => v===a).length
            - arr.filter(v => v===b).length
        ).pop();
    }

    clone(a) {
        return JSON.parse(JSON.stringify(a));
    }

    async asKeyManage() {
        const asKey = await this.getAsKeyDB()
        if (!asKey || asKey.length === 0) await this.setAsKeyDB()
    }

    async readCycles() {
        return new Promise((resolve, reject)=>{
            const dayAgo = Date.now() - 24 * 60 * 60 * 1000
            this.cyclesColl.find({ts: {$gt: dayAgo}}).toArray(async (err, key) => {
                if (err) return resolve([])
                for (let i in key) {
                    key[i].fromNow = moment(key[i].ts).fromNow()
                    key[i].award = this.round(key[i].award, 3)
                    key[i].jsonValRec = JSON.stringify(key[i].validReceives)
                }
                key = key.sort((a,b) => b.ts - a.ts)
                key = key.slice(0,10)
                resolve(key)
            })
        })
    }

    async readSendCycles() {
        const cycles = await this.readCycles()
        return cycles.filter(e => e.event === 'send')
    }


    async setAsKeyDB() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
            modulusLength: 1024, // The standard secure default length for RSA keys is 2048 bits
        });
        const asPubKey = publicKey.export({
            type: "pkcs1",
            format: "pem",
        })
        const asPrivKey = privateKey.export({
            type: "pkcs1",
            format: "pem",
        })
        await this.asKey.insert({pub:asPubKey, priv:asPrivKey})
    }

    async getAsKeyDB() {
        return new Promise((resolve, reject)=>{
            this.asKey.find({}).toArray(async (err, key) => {
                resolve(key)
            })
        })
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

    decrypt(privkey, result) {
        if (!result.includes(';;;;;')) {
            return result
        } else {
            const encryptedData = result.split(';;;;;')[0]
            const encryptedSymKey64 = result.split(';;;;;')[1]
            const encryptedSymKey = Buffer.from(encryptedSymKey64, "base64");
            const symKeyHex = crypto.privateDecrypt(
                {
                    key: privkey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: "sha256",
                },
                encryptedSymKey
            );
            const symKey = symKeyHex.toString()
            const decryptedData = CryptoJS.AES.decrypt(encryptedData, symKey).toString(CryptoJS.enc.Utf8)
            return decryptedData
        }
    }

    save() {
        fs.writeFileSync("./data/tmpkp.json", JSON.stringify(this.KP));
    }

    coinModule (coin) {
        return config.coinLookup.find(e => e.coin === coin).module
    }

    calcCrow(lat1, lon1, lat2, lon2)
    {
        var R = 6371; // km
        var dLat = this.toRad(lat2-lat1);
        var dLon = this.toRad(lon2-lon1);
        var lat1 = this.toRad(lat1);
        var lat2 = this.toRad(lat2);

        var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        var d = R * c;
        return d;
    }

    // Converts numeric degrees to radians
    toRad(Value)
    {
        return Value * Math.PI / 180;
    }
}

String.prototype.replaceAll = function(match, replace) {
    return this.replace(new RegExp(match, 'g'), () => replace);
}


module.exports = pactRadioService


