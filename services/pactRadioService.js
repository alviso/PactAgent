const Pact = require("pact-lang-api");
const config = require("../config.js");
const runTasks = require("./runTasks.js");
const moment = require("moment")
const axios = require("axios")
const crypto = require("crypto");
const CryptoJS = require("crypto-js");
const Engine = require('tingodb')()
const app = require('../app')


class pactRadioService {

    constructor(chain, cS) {
        this.KP = {}
        this.wallet = ''
        this.chain = chain
        this.cS = cS
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

            if (await this.allowedToGo() !== 0) return
            await this.checkMyNode()


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

    async allowedToGo() {
        return new Promise((resolve, reject)=>{
            this.txnColl.find({ "result" : { "$exists" : false } }).toArray(async (err, txns) => {
                // console.log(this.chain.name, txns.length)
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
        return true
    }

    async checkMyNode() {
        const myNode = await this.getMyNode()
        if (!myNode?.address) {
            await this.insertMyNode()
        } else {
            if (myNode.send === true) {
                const MIC = await this.cS.sendPing()
                console.log(MIC)
                await this.updateSent(MIC)
            }
            const recs = this.cS.getRecs()
            recs.forEach(rec => {
                this.addReceived(rec)
                this.cS.removeRec(rec)
            })
        }
    }

    async getMyNode() {
        const cmdObj = this.makeCmdObj('free.radio02.get-my-node')
        const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
        return resp.result?.data || {}
    }

    async insertMyNode() {
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`free.radio02.insert-my-node  \"${config.chirpstack.gatewayId}\"`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
        };
        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        console.log(this.chain.name, 'Insert my node: ', resp)
        if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], 'Insert my node')
        return resp || {}
    }

    async updateSent(MIC) {
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`free.radio02.update-sent  \"${MIC}\"`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
        };
        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        console.log(this.chain.name, 'Update sent: ', resp)
        if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], 'Update sent')
        return resp || {}
    }

    async addReceived(rec) {
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`free.radio02.add-received  \"${rec.gatewayId}\" \"${rec.mic}\"`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
        };
        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        console.log(this.chain.name, 'Add received: ', resp)
        if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], 'Add received')
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
        return resp.result?.data?.balance || 0
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

    makeCmdObj(func) {
        const envData = {
            keyset: {
                pred: "keys-all",
                keys: [this.KP.publicKey]
            }
        }
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`${func}`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId,
            envData
        };
        return cmdObj
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

}



module.exports = pactRadioService


