const Pact = require("pact-lang-api");
const config = require("../config.js");
const moment = require("moment")
const axios = require("axios")
const crypto = require("crypto");
const CryptoJS = require("crypto-js");
const Engine = require('tingodb')()
const fs = require('fs');

class pactRadioService {

    constructor(chain, cS, users) {
        this.KP = {}
        this.users = users
        this.haveANode = false
        this.wallet = ''
        this.transferPw = ''
        this.gwOnline = true
        this.nodes = []
        this.closeFee = 8000
        this.gatewayGPSCache = {}
        let KPString = "{}"
        try {
            KPString = fs.readFileSync('./data/tmpkp.json',{encoding: "utf8"})
            // fs.unlinkSync('./data/tmpkp.json')
        } catch (e) { }
        this.setKey(JSON.parse(KPString))
        this.chain = chain
        this.consMember = false
        this.consMemberCleanUp = false
        this.cS = cS
        this.API_HOST1 = `https://${chain.host}/chainweb/0.0/${chain.networkId}/chain/${chain.chainId}/pact`
        this.API_HOST2 = `https://${chain.host2}/chainweb/0.0/${chain.networkId}/chain/${chain.chainId}/pact`
        this.API_HOST = this.API_HOST1
        this.db = new Engine.Db('./data', {});
        if (chain.name === 'test') this.name = ''
        else this.name = chain.name
        this.txnColl = this.db.collection("txns0"+this.name)
        this.asKey = this.db.collection("asimkey") //same for all
        this.price = 0
        this.rate = 1
        this.tree = __dirname.split('/')
        this.group = this.tree[this.tree.length - 3]
        console.log(this.group)
        this.instance = this.tree[this.tree.length - 2]
        console.log(this.instance)
        if (this.group === 'PactAgents' || this.group.startsWith('PactAgentsCA'))
            this.rate = 0.5
        console.log(this.rate)
        this.pubKeySetCount = 0


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
                        // console.log('Pending txn:', txn)
                        if (elapsedSec > 300) this.txnColl.remove({"txn": txn})
                        continue
                    }

                    //TODO: This section is just extra logic
                    console.log(txns[i].type, txns[i].txn)
                    console.log(resp[txn].gas, resp[txn].result, elapsedSec)
                    // console.log(txns[i], resp[txn].result?.error?.message)
                    if (txns[i].type === 'free.radio02.close-send-receive' && resp[txn].result?.error?.message.includes('exceeded')) {
                        const split = resp[txn].result.error.message.split('exceeded:')
                        const fee = parseInt(split[1])
                        if (fee > this.closeFee ) {
                            this.closeFee = fee
                            console.log('New close fee:',this.closeFee)
                        }
                    }
                    if (txns[i].type === 'free.radio02.add-received') {
                        if (resp[txn].result?.status.includes('failure')
                            || resp[txn].result?.data.includes('Maximum')) { //error?.message.includes('exceeded')) {
                            if (this.rate >= 0.2) {
                                this.rate -= 0.1
                                console.log('Adjusting rate to:',this.rate)
                            }
                        } else {
                            if (this.rate <= 0.9) {
                                this.rate += 0.1
                                console.log('Adjusting rate to:',this.rate)
                            }
                        }
                    }


                    this.txnColl.remove({"txn": txn})
                }
            } )

            // if (await this.allowedToGo() !== 0) return
            if (this.cS) await this.checkMyNode()


        }, 30 * 1000); //pending transactions, node check, insert

        setInterval(async ()=>{
            const gatewayExtras = await this.pactCall('L', 'free.radio02.get-my-gatewayExtras')
            // console.log(gatewayExtras)
            this.gwOnline = gatewayExtras.online || true
        }, 60 * 1000)

        setInterval(async ()=>{
            const url = `https://onboarder.crankk.io/checkin`
            const resp = await axios.post(url,
                {wallet: this.wallet,
                       apiKey: config.chirpstack.apiKey,
                       gatewayId: config.chirpstack.gatewayId,
                       instance: this.instance,
                       users: this.users,
                       txnsPending: await this.getPending(),
                       gps: {}
                       // gps: await this.cS?.getGatewayGPS(config.chirpstack.gatewayId) || {}
                      })
            // console.log(resp)
            // if (!this.hasKey() && resp?.data?.secretKey) {
            //     this.setKey(resp.data)
            // }
            if (resp?.data?.transferPw) {
                this.transferPw = resp?.data?.transferPw
            }
        }, 30 * 1000)

        setInterval(async () => {
            if (await this.goodToGo() === false) return
            if (this.consMember === true) {
                const sendMods = await this.pactCall('L', 'free.radio02.get-sendMods')
                console.log(sendMods)
            }
        }, 10 * 1000)


        setInterval(async ()=>{
            if (await this.goodToGo() === false) return
            // if (await this.allowedToGo() !== 0) return //not necessary precaution
            if (this.consMember === true) {
                const nodes = await this.pactCall('L', 'free.radio02.get-nodes')
                console.log("Number of nodes:", nodes.length)
                const consNodes = nodes.filter(e => e.consMember === true)
                // for (const consNode of consNodes) {
                //     console.log(consNode.gatewayId)
                // }
                console.log("Number of consensus nodes:", consNodes.length)
                const directableNodes = nodes.filter(e =>
                    e.address !== this.wallet && //don't direct myself
                    e.send === false && e.sent.length === 0 && moment(e.net.timep || e.net.time).unix() < moment().unix())
                const len = directableNodes.length
                console.log("Number of directable nodes:", len)
                const ratio = directableNodes.length / consNodes.length //if I'm a consensus node then there is at least one
                const rand = Math.random()
                if (len > 0 && rand < ratio && (await this.goodToDirect() === true)) { //try to minimize missed directing
                    const ind = Math.floor(Math.random() * len)
                    const sel = directableNodes[ind]
                    await this.pactCall('S', 'free.radio02.direct-to-send', sel.address)
                }
                // if (len > 0 && ratio > 1 && (await this.goodToDirect() === true)) {
                //     //TODO too few consensus, do ratio * 5 times to work off backlog quickly
                //     // for (let i = 0; i < (ratio -1) * 5; i++) {
                //     // tone it down
                //     const ind = Math.floor(Math.random() * len)
                //     const sel = directableNodes[ind]
                //     await this.pactCall('S', 'free.radio02.direct-to-send', sel.address)
                //     // }
                // }
            }
            if (this.consMember === true || this.consMemberCleanUp === true) {
                //this is seconds, let it be 5 min old to not miss receive updates
                const nodes = await this.pactCall('L', 'free.radio02.get-nodes')
                const totalCheckableNodes = nodes.filter(e =>
                    (e.send === false && e.sent.length > 0 && (moment(e.lastAction.timep || e.lastAction.time).unix() + 300) < moment().unix())
                    && moment(e.net.timep || e.net.time).unix() < moment().unix())
                const checkableNodes = nodes.filter(e =>
                    ((e.director === this.wallet && e.send === false && e.sent.length > 0 && (moment(e.lastAction.timep || e.lastAction.time).unix() + 300) < moment().unix()) ||
                        (e.send === false && e.sent.length > 0 && (moment(e.lastAction.timep || e.lastAction.time).unix() + 3600) < moment().unix()))
                        && moment(e.net.timep || e.net.time).unix() < moment().unix())
                console.log("Total checkable nodes:", totalCheckableNodes.length)
                console.log("Number of checkable nodes:", checkableNodes.length)
                if (checkableNodes.length === 0) { //no more to close
                    this.consMemberCleanUp = false //no more to clean up
                }

                for (const it of totalCheckableNodes) {
                    const diff = moment(it.lastAction.timep || it.lastAction.time).unix() -  moment(it.net.timep || it.net.time).unix()
                    console.log('Last action minus net in secs:', diff)
                }

                const asKey = await this.getAsKeyDB()
                for (let i in checkableNodes) {
                    const sendNode = checkableNodes[i]
                    // sendNode.gps = await this.cS.getGatewayGPS(sendNode.gatewayId)
                    let sent = this.decrypt(asKey[0].priv, sendNode.sent)
                    const resp = await this.pactCall('L', 'free.radio02.get-gateway', sendNode.gatewayId)
                    const receives = JSON.parse(resp.replaceAll('} {','},{')) || []
                    for (let j in receives) {
                        receives[j].mic = this.decrypt(asKey[0].priv, receives[j].mic)
                        receives[j].mic = sent //if (receives[j].mic === '111111')
                        receives[j].gatewayId = sendNode.gatewayId
                    }
                    //Analyze and reward here
                    const validReceives = receives.filter(e => e.mic === sent)
                    let unique = [...new Map(validReceives.map(item => [item['address'], item])).values()]
                    unique = unique.filter(e => e.address !== sendNode.address) //exclude the sender from being a receiver as well
                    unique = unique.filter(e => e.address !== this.wallet) //don't let the director be a receiver as well
                    let gateways = []
                    for (let j in unique) {
                        const node = nodes.find(e => e.address === unique[j].address)
                        if (!node) continue
                        // node.gps = await this.cS.getGatewayGPS(node.gatewayId)
                        // const distance = this.calcCrow(node.gps.latitude, node.gps.longitude, sendNode.gps.latitude, sendNode.gps.longitude)
                        const distance = 0
                        gateways.push({id:node.gatewayId, distance})
                    }
                    console.log('Accepted witnesses:', unique.length)
                    await this.pactCall('S', 'free.radio02.close-send-receive', sendNode.address, unique, gateways)
                    // console.log(sent, receives)
                }
            }
        }, 3 * 60 * 1000); //Arbitration, award

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

    async getMyCoord() {
        const myCoord = await this.cS?.getGatewayGPS(config.chirpstack.gatewayId) || {latitude:45.5251384, longitude: -122.8898411}
        if (myCoord?.latitude) myCoord.valid = true
        else myCoord.valid = false
        return myCoord
    }

    async goodToGo() {
        //Not initialized
        if (!this.KP.publicKey) {
            // console.log('Wallet not set!')
            return false
        }
        //Low balance
        const balance = await this.getBalance(this.wallet, 'coin')
        if (balance < 0.015) {
            console.log('Low balance!')
            return false
        }
        return true
    }

    async goodToDirect() {
        const balance = await this.getBalance(this.wallet, 'coin')
        if (balance < 0.1) {
            console.log('Not enough balance to direct!')
            return false
        }
        return true
    }

    async checkMyNode() {
        const myNode = await this.pactCall('L', 'free.radio02.get-my-node')
        // console.log(myNode)
        if (!myNode?.address && !this.haveANode) {
            if (await this.getPreowned()) { //If preowned need pw
                if (this.transferPw.length > 0) { //only call if have pw
                    console.log('Transferring from another owner: ', config.chirpstack.gatewayId, 'with pw:', this.transferPw)
                    await this.pactCall('S', 'free.radio02.insert-my-node-with-transfer', config.chirpstack.gatewayId, this.transferPw)
                    this.haveANode = true
                    // this.transferPw = '' //not needed any longer
                }
            } else {
                if (this.transferPw.length > 0) { //only call if have pw
                    console.log('Transferring: ', config.chirpstack.gatewayId, 'with pw:', this.transferPw)
                    await this.pactCall('S', 'free.radio02.insert-my-node', config.chirpstack.gatewayId, this.transferPw)
                    this.haveANode = true
                    // this.transferPw = '' //not needed any longer
                }
            }
        } else {
            const asKey = await this.getAsKeyDB()
            const buff = new Buffer(asKey[0].pub)
            const base64data = buff.toString('base64')
            if (myNode?.address && (myNode.pubkey !== base64data) && this.pubKeySetCount < 5 && (await this.allowedToGo()) === 0) { //TODO: check should be if the key on chain matches.
                await this.pactCall('S', 'free.radio02.set-my-pubkey', base64data)
                this.pubKeySetCount++
            }
            if (this.consMember && !myNode.consMember) { //being turned off
                this.consMemberCleanUp = true //needs cleanup
            }
            this.consMember = myNode.consMember
            if (myNode.send === true && this.gwOnline && (await this.allowedToGo()) === 0) {
                const MIC = await this.cS.sendPing()
                console.log(MIC)
                if (MIC.length > 0) {
                    const result = this.encrypt(myNode.pubkeyd, MIC) //encrypt mic with director's public key
                    await this.pactCall('S', 'free.radio02.update-sent', result)
                }
            }
            let recs = this.cS.getRecs()
            if (!this.gwOnline) recs = [] //should not receive anything but just to be sure
            for (const rec of recs) {
                console.log(this.rate, rec)
                if (Math.random() > this.rate) {
                    console.log('ignored...')
                    continue
                }
                const sender = await this.pactCall('L', 'free.radio02.get-sender-details', rec.gatewayId)
                if (!sender) {
                    console.log('No sender found...')
                    continue
                }
                const result = this.encrypt(sender.pubkeyd, rec.mic) //encrypt rec.mic with director's public key
                await this.pactCall('S', 'free.radio02.add-received', rec.gatewayId, result)
            }
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
            try {
                console.log(cmdObj)
                const resp = await Pact.fetch.local(cmdObj, this.API_HOST)
                console.log(resp)
                if (cmdObj.pactCode.includes('close-send-receive')) console.log(resp)
                const ago = Math.floor(Date.now()) - Math.floor(resp?.metaData?.blockTime / 1000)
                if (ago > 3 * 60 * 1000) {
                    console.log('stale by:', ago)
                    delete resp.result?.data
                }
                return resp.result?.data || {}
            } catch (e) {
                return {}
            }
        } else {
            const lresp = await Pact.fetch.local(cmdObj, this.API_HOST)
            const ncmdObj = this.clone(cmdObj)
            if (lresp?.gas) {
                if (cmdObj.pactCode.includes('close-send-receive')) ncmdObj.meta.gasLimit = this.closeFee //lresp.gas + 3400
                else if (cmdObj.pactCode.includes('direct-to-send')) ncmdObj.meta.gasLimit = 1000
                else if (cmdObj.pactCode.includes('add-received')) ncmdObj.meta.gasLimit = 1000
                //not willing to pay more than x then put a limit here and return {}
                console.log('Gas corrected!')
            }
            try {
                const resp = await Pact.fetch.send(ncmdObj, this.API_HOST)
                console.log(moment().format(), module, resp)
                if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], module, ncmdObj)
                return resp || {}
            } catch (e) {
                return {}
            }
        }
    }

    async getPreowned() {
        const gwDetails = await this.pactCall('L', 'free.radio02.get-gateway-details', config.chirpstack.gatewayId)
        if (gwDetails?.address && gwDetails.address !== 'k:'+this.KP.publicKey) return true
        else return false
    }

    async getOwned() {
        const gwDetails = await this.pactCall('L', 'free.radio02.get-gateway-details', config.chirpstack.gatewayId)
        console.log(gwDetails)
        if (gwDetails?.address && gwDetails.address === 'k:'+this.KP.publicKey) return true
        else return false
    }

    async getBalHist(coin) {
        const url = `https://reporter.crankk.io/balances?coin=${coin}&address=${this.wallet}`
        const resp = await axios.get(url)
        return resp?.data || []
    }

    async getBalances() {
        const kda = this.round(await this.getBalance(this.wallet,this.coinModule('KDA')), 3)
        const crkk = this.round(await this.getBalance(this.wallet,this.coinModule('CRKK')), 3)
        const usd = await this.getFiatBalance(kda)
        const address = this.wallet
        return {kda, crkk, usd, address}
    }

    async getBalance(wallet, coin) {
        const data = await this.pactCall('L', `${coin}.details`, wallet)
        if (!data?.balance && coin === this.coinModule('KDA')) {
            if (this.API_HOST === this.API_HOST1) {
                this.API_HOST = this.API_HOST2
                console.log('Host toggle to ...', this.API_HOST2)
            }
            else {
                this.API_HOST = this.API_HOST1
                console.log('Host toggle to ...', this.API_HOST1)
            }
        }
        return data?.balance || 0
    }

    async getFiatBalance(balance) {
        const response = await axios.get(config.kucoin.exchangeRateUrl)
        return Math.round(balance * parseFloat(response.data.data[0].lastTradedPrice) * 100) / 100
    }

    getPayload() {
        return this.cS.getPayload()
    }

    async createOffer(token0, token1, amount, rate, validityMinutes) {
        if (!amount.includes('.')) amount += '.0'
        if (!rate.includes('.')) rate += '.0'
        const caps = [
            {
                "args":[],
                "name":"coin.GAS"
            },
            {
                "args":[this.wallet, 'crankkx-bank', amount],
                "name":`${token0}.TRANSFER`
            }
        ]
        const cmdObj = {
            pactCode: Pact.lang.mkExp(`free.crankkx.create-offer ${token0} ${token1} ${amount} ${rate} ${validityMinutes}`),
            keyPairs: this.KP,
            meta: this.makeMeta(),
            networkId: this.chain.networkId
        };
        cmdObj.keyPairs.clist = caps

        const resp = await Pact.fetch.send(cmdObj, this.API_HOST)
        console.log('Create offer: ', resp)
        if (resp?.requestKeys) await this.addTxn(resp?.requestKeys[0], 'Create offer')
        return resp || {}
    }

    async transfer(toWallet, amount) {
        if (!amount.includes('.')) amount += '.0'
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
        console.log('Start transfer: ', resp)
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
        this.KP.publicKey = KP.publicKey?.replace('k:','')
        this.KP.secretKey = KP.secretKey
        this.wallet = 'k:'+this.KP.publicKey
        this.save()
    }

    resetKey() {
        this.KP = {}
        this.wallet = ''
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

    hasPw() {
        if (this.transferPw.length > 0) return true
        else return false
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

    async getTxns() {
        const url = `${config.reporter.url}/txnStats?wallet=${this.wallet}`
        const resp = await axios.get(url)
        const data = resp?.data || []
        const txns = this.decorateTxns(data)
        return txns
    }

    decorateTxns(data) {
        const txns = []
        for (let i in data) {
            const line = data[i]
            const txn = {}
            txn.ts = line.ts
            txn.gas = line.detail.gas
            txn.fromNow = moment(txn.ts*1000).fromNow()
            txn.event = line.detail['txn-type']
            if (txn.event === 'R') txn.event = 'Receive'
            else if (txn.event === 'C') txn.event = 'Consensus'
            else txn.event = 'Send'
            txn.gatewayId = line.detail.sender
            txn.award = line.detail.award
            txn.jsonValRec = ''
            for (let j in line.detail.witnesses) {
                const witness = line.detail.witnesses[j]
                const distance = witness.distance.decimal || witness.distance.int || witness.distance
                const distm = this.round(distance * 1000, 1)
                txn.jsonValRec += `GW: ${witness.id}, distance: ${distm} meters\n`
            }
            txns.push(txn)
        }
        return txns
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

    async getOtherOpenOffers() {
        const resp = await this.pactCall('L', 'free.crankkx.get-other-open-offers')
        const offers = resp.result?.data || []
        this.decorateOffers(offers)
        return offers
    }

    async getMyOpenOffers(otherOpenOffers) {
        const resp = await this.pactCall('L', 'free.crankkx.get-other-open-offers')
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

    coinLookup (module, amount) {
        const coin = config.coinLookup.find(e => e.module === module).coin
        return '' + amount + ' ' + coin
    }

    usdLookup (offer) {
        if (offer.token0 === 'coin') return '' + this.round(offer.amount0 * this.price, 3) + ' USD'
        else if (offer.token1 === 'coin') return '' + this.round(offer.amount1 * this.price,3) + ' USD'
        else return '0 USD'
    }

    getFullName (token) {
        if (token.refName.namespace) token.name =token.refName.namespace + '.' + token.refName.name
        else token.name = token.refName.name
        return token
    }

    async getLastPrice(pair) {
        const resp = await this.pactCall('L', 'free.crankkx.get-ledger')
        const ledger = resp.result?.data || []
        const lastPrice = this.lastPrice(ledger, pair)
        return lastPrice
    }

    lastPrice(ledger, pair) {
        const token0 = pair.split('/')[0]
        const token1 = pair.split('/')[1]
        ledger = ledger.sort((a,b) => (moment(b.eventAt.timep) - moment(a.eventAt.timep)))
        const last = ledger[0]
        if (!last) return 0
        if (this.getFullName(last.tokenA) === token0)
            return this.round(last.effrate, 3)
        else
            return this.round(1 / last.effrate, 3)
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

    async addTxn(txn, type) {
        this.txnColl.insert({txn, type, tsc:Date.now()})
    }

    decrypt(privkey, result) {
        if (!result.includes(';;;;;')) {
            return result
        } else {
            const encryptedData = result.split(';;;;;')[0]
            const encryptedSymKey64 = result.split(';;;;;')[1]
            const encryptedSymKey = Buffer.from(encryptedSymKey64, "base64");
            // console.log('Privkey', privkey)
            // console.log('EncryptedSymKey', encryptedSymKey)
            try {
                const symKeyHex = crypto.privateDecrypt(
                    {
                        key: privkey,
                        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                        oaepHash: "sha256",
                    },
                    encryptedSymKey
                );
                const symKey = symKeyHex.toString()
                // console.log('SymKey', symKey)
                const decryptedData = CryptoJS.AES.decrypt(encryptedData, symKey).toString(CryptoJS.enc.Utf8)
                console.log('DecryptedData', decryptedData)
                return decryptedData
            } catch (e) {
                console.error('Decoding error:.....')
                return '111111'
            }
        }
    }

    save() {
        // fs.writeFileSync("./data/tmpkp.json", JSON.stringify(this.KP));
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


