const Pact = require("pact-lang-api");
const config = require("../config.js");
const moment = require("moment")
const axios = require("axios")
const crypto = require("crypto");
const CryptoJS = require("crypto-js");
const Engine = require('tingodb')()

class pactRadioService {

    constructor(chain, cS) {
        this.KP = {}
        this.wallet = ''
        this.chain = chain
        this.consMember = false
        this.cS = cS
        this.API_HOST = `https://${chain.host}/chainweb/0.0/${chain.networkId}/chain/${chain.chainId}/pact`
        this.db = new Engine.Db('./data', {});
        if (chain.name === 'test') this.name = ''
        else this.name = chain.name
        this.balanceColl = this.db.collection("balance"+this.name)
        this.txnColl = this.db.collection("txns0"+this.name)
        this.feeColl = this.db.collection("fee0"+this.name)
        this.asKey = this.db.collection("asimkey") //same for all
        this.price = 0
        this.asKeyManage()

        setInterval(async ()=>{
            if (await this.goodToGo() === false) return
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
            await this.checkMyNode()


        }, 10 * 1000); //pending transactions, node check, insert

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
                        this.balanceColl.remove({'ts': {$lt: now - 21 * 24 * 60 * 60 * 1000}})
                    }
                }
            } )
        }, 60 * 1000); //balance update

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
            const checkableNodes = nodes.filter(e => e.send === false && e.sent.length > 0)
            for (let i in checkableNodes) {
                const node = checkableNodes[i]
                const sent = this.decrypt(node.sent)
                const resp = await this.pactCall('L', 'free.radio02.get-gateway', node.gatewayId)
                const receives = JSON.parse(resp.replaceAll('} {','},{')) || []
                //Analyze and reward here
                const validReceives = receives.filter(e => this.decrypt(e.mic) === sent)
                const unique = [...new Map(validReceives.map(item => [item['address'], item])).values()]
                await this.pactCall('S', 'free.radio02.close-send-receive', node.address, unique)
                // await this.closeSendReceive(node.address, JSON.stringify(unique))
                console.log(sent, receives)
            }

        }, 5 * 60 * 1000);

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
        const myNode = await this.pactCall('L', 'free.radio02.get-my-node')
        if (!myNode?.address) {
            await this.pactCall('S', 'free.radio02.insert-my-node', config.chirpstack.gatewayId)
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
                }
            }
            const recs = this.cS.getRecs()
            recs.forEach(rec => {
                console.log(rec)
                const result = this.encrypt(myNode.pubkeyd, rec.mic) //encrypt rec.mic with director's public key
                this.pactCall('S', 'free.radio02.add-received', rec.gatewayId, result)
            })
            this.cS.rmRecs()
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
            const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
            return resp.result?.data || {}
        } else {
            const lresp = await Pact.fetch.local(cmdObj, this.API_HOST)
            // console.log(this.chain.name, module, lresp)
            const ncmdObj = this.clone(cmdObj)
            if (lresp?.gas) {
                ncmdObj.meta.gasLimit = lresp.gas
                console.log('Gas corrected!')
            }
            const resp = await Pact.fetch.send(ncmdObj, this.API_HOST)
            console.log(this.chain.name, module, resp)
            if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], module)
            return resp || {}
        }
    }

    async getNumberOfGateways() {
        const gwKeys = await this.pactCall('L', 'free.radio02.get-gateways-keys')
        return gwKeys.length
    }

    async getBalances() {
        const kda = this.round(await this.getBalance(this.wallet,'coin'), 3)
        const crkk = this.round(await this.getBalance(this.wallet,'free.crankk01'), 3)
        const usd = await this.getFiatBalance(kda)
        return {kda, crkk, usd}
    }

    async getDistributedCRKK() {
        const radioBankBalance = this.round(await this.getBalance(config.kadena.radioBank, 'free.crankk01'), 2)
        return Math.round((10000 - radioBankBalance) * 100) / 100
    }

    async getBalance(wallet, coin) {
        const data = await this.pactCall('L', `${coin}.details`, wallet)
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

    clone(a) {
        return JSON.parse(JSON.stringify(a));
    }

    async asKeyManage() {
        const asKey = await this.getAsKeyDB()
        if (asKey.length === 0) await this.setAsKeyDB()
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

    async decrypt(result) {
        if (!result.includes(';;;;;')) {
            return result
        } else {
            const encryptedData = result.split(';;;;;')[0]
            const encryptedSymKey64 = result.split(';;;;;')[1]
            const encryptedSymKey = Buffer.from(encryptedSymKey64, "base64");
            const asKey = await this.getAsKeyDB()
            const symKeyHex = crypto.privateDecrypt(
                {
                    key: asKey[0].priv,
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

}

String.prototype.replaceAll = function(match, replace) {
    return this.replace(new RegExp(match, 'g'), () => replace);
}


module.exports = pactRadioService


