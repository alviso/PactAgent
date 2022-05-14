const fs = require('fs')

let gwConfFile = '{}'
let apikeyFile = '{}'
try {
    gwConfFile = fs.readFileSync('/opt/ttn-gateway/packet_forwarder/lora_pkt_fwd/local_conf.json', 'utf8')
} catch (e) {}
const gwConfJson = JSON.parse(gwConfFile)
try {
    apikeyFile = fs.readFileSync('./apikey.json', 'utf8')
} catch (e) {}
const apikeyJson = JSON.parse(apikeyFile)

module.exports = {
    coinLookup: [
        {coin: 'KDA', module: 'coin'},
        {coin: 'CRKK', module: 'free.crankk01'}
    ],
    chains: [
        // {name: 'test', host: 'testnet.crankk.io', color: 'danger', networkId: 'testnet04', chainId: '1'}
        {name: 'main', host: 'mainnet.crankk.io', color: 'success', networkId: 'mainnet01', chainId: '0'} //api.chainweb.com
    ],
    kadena: {
        radioModule: 'free.radio02',
        radioBank: 'radio01-bank',
        totSup: 10000000,
        gasPrice: 0.000001,
        gasLimit: 10000,
        ttl: 28800,
    },
    kucoin: {
        exchangeRateUrl: 'https://m.kucoin.com/_api/trade-front/market/getSymbolTick?symbols=KDA-USDT&lang=en_US',
        historyUrl: 'https://m.kucoin.com/_api/order-book/candles?symbol=KDA-USDT&type=1day'
    },
    github: {
        pactAgentUrl: 'https://api.github.com/users/alviso/events/public'
    },
    chirpstack: {
        apiUrl: 'live-us.alertjack.com:8080',
        gatewayId: gwConfJson?.gateway_conf?.gateway_ID.toLowerCase() || '',
        apiKey: apikeyJson?.apikey || '',
    },
    website: true
};
