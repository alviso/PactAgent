const os = require('os-utils');

class machineService {

    constructor() {
        setInterval(async ()=>{
            // os.cpuUsage(function(v){
            //     console.log( 'CPU Usage (%): ' + v );
            // });
            // console.log( 'Free memory (%): ' + os.freememPercentage() );
        }, 1 * 1000)

    }


}


module.exports = machineService
