const scanner = require('node-wifi-scanner');

class connectionService {


    async scan() {
        return new Promise((resolve, reject)=>{
            scanner.scan((err, networks) => {
                if (err) {
                    console.error(err);
                    return resolve([])
                }
                networks = networks.filter(e=>e.ssid.length>0)
                networks = networks.sort((a,b)=>(b.rssi - a.rssi))
                console.log(networks)
                return resolve(networks)
            })
        })
    }
}

module.exports = connectionService