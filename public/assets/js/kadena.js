const excModule = 'free.crankkx'
const excBank = 'crankkx-bank'
const networkId =  'mainnet01'
const chainId = '0'
const apiServer = `https://mainnet.crankk.io/chainweb/0.0/${networkId}/chain/${chainId}/pact`
const gasPrice = 0.000001
const gasLimit = 10000
const ttl = 28800


function prepareExchange(wallet, token0, token1, amount, rate, validityMinutes) {
    const keyPairs = {}
    const floatAmount = parseFloat(amount)
    const pubKey = (wallet.split(':'))[1]
    keyPairs.publicKey = pubKey
    keyPairs.secretKey = sessionStorage.getItem('prKey-pactAgent')
    if (!amount.includes('.')) amount += '.0'
    if (!rate.includes('.')) rate += '.0'
    const caps = [
        {
            "args":[],
            "name":"coin.GAS"
        },
        {
            "args":[wallet, excBank, floatAmount],
            "name": token0 + ".TRANSFER"
        }
    ]
    keyPairs.clist = caps
    const envData = {
        keyset: {
            pred: "keys-all",
            keys: [pubkey]
        }
    }
    const cmdObj = {
        pactCode: `(${excModule}.create-offer ${token0} ${token1} ${amount} ${rate} ${validityMinutes})`,
        keyPairs,
        meta: makeMeta(wallet),
        networkId,
        envData
    };
    return cmdObj
}

function prepareCancel(wallet, key) {
    const keyPairs = {}
    keyPairs.publicKey = wallet
    keyPairs.secretKey = sessionStorage.getItem('prKey-pactAgent')
    const envData = {
        keyset: {
            pred: "keys-all",
            keys: [wallet]
        }
    }
    const cmdObj = {
        pactCode: `(${excModule}.cancel-offer \"${key}\")`,
        keyPairs,
        meta: makeMeta(wallet),
        networkId,
        envData
    };
    return cmdObj
}

function prepareExecTrade(wallet, key, key1) {
    const keyPairs = {}
    keyPairs.publicKey = wallet
    keyPairs.secretKey = sessionStorage.getItem('prKey-pactAgent')
    const envData = {
        keyset: {
            pred: "keys-all",
            keys: [wallet]
        }
    }
    const cmdObj = {
        pactCode: `(${excModule}.match-offer \"${key}\" \"${key1}\")`,
        keyPairs,
        meta: makeMeta(wallet),
        networkId,
        envData
    };
    return cmdObj
}

function makeMeta(wallet) {
    return Pact.lang.mkMeta(
        wallet,
        chainId,
        gasPrice,
        gasLimit,
        creationTime(),
        ttl
    )
}

function creationTime() {
    return Math.round(new Date().getTime() / 1000) - 15
}
