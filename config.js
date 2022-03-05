// config.js
// This file contains private configuration details.
// Do not add it to your Git repository.
const fs = require('fs')

module.exports = {
    //Kadena related
    coinLookup: [
        {coin: 'KDA', module: 'coin'},
        {coin: 'CRKK', module: 'free.crankk01'}
    ],
    chains: [
        // {name: 'test', host: 'testnet.crankk.io', color: 'danger', networkId: 'testnet04', chainId: '1'}
        // {name: 'main', host: 'api.chainweb.com', color: 'success', networkId: 'mainnet01', chainId: '0'}
    ],
    kadena: {
        agentModule: 'free.pactAgent18',
        exchModule: 'free.crankkx',
        gasPrice: 0.000001,
        gasLimit: 150000,
        ttl: 28800,
        exchangeRate: 0.0001
    },
    kucoin: {
        exchangeRateUrl: 'https://m.kucoin.com/_api/trade-front/market/getSymbolTick?symbols=KDA-USDT&lang=en_US',
        historyUrl: 'https://m.kucoin.com/_api/order-book/candles?symbol=KDA-USDT&type=1day'
    },
    chirpstack: {
        apiUrl: '192.168.0.203:8080',
        gatewayId: JSON.parse(fs.readFileSync('/opt/ttn-gateway/packet_forwarder/lora_pkt_fwd/local_conf.json', 'utf8')).gateway_conf.gateway_ID.toLowerCase(), //'e45f01fffe1744ab',
        email: 'admin',
        password: 'admin'
    }

};
