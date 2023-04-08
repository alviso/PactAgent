const config = require("../config.js");
const grpc = require('@grpc/grpc-js')
const gatewayService = require('@crankk.io/chirpstack-api-fork/as/external/api/gateway_grpc_pb')
const gatewayMessages = require('@crankk.io/chirpstack-api-fork/as/external/api/gateway_pb')

class chirpstackService {

    constructor() {
        this.tree = __dirname.split('/')
        this.instance = this.tree[this.tree.length - 3]
        if (this.instance.includes('CONS'))
            this.consNode = true
        else this.consNode = false
        this.technical = true
        this.apiUrl = config.chirpstack.apiUrl

        if (this.instance.includes('PactAgentsCB')) {
            console.log('Directory:', this.instance)
            this.apiUrl = config.chirpstack.apiUrl2
            console.log(this.apiUrl)
        }

        this.recs = []
        this.payload = []
        this.startupTs = Date.now()
        this.metadata = new grpc.Metadata();
        this.metadata.set('authorization', config.chirpstack.apiKey);
        this.gatewayServiceClient = new gatewayService.GatewayServiceClient(
            this.apiUrl,
            grpc.credentials.createInsecure()
        )

        if (config.chirpstack.gatewayId && !this.consNode) {
            this.streamEvents()
            console.log('Streaming events')
        }
    }

    streamEvents() {

        const streamFrameLogsRequest = new gatewayMessages.StreamGatewayFrameLogsRequest()
        streamFrameLogsRequest.setGatewayId(config.chirpstack.gatewayId)
        const clientReadableStream = this.gatewayServiceClient.streamFrameLogs(streamFrameLogsRequest, this.metadata)
        this.startupTs = Date.now() //In case of disconnect, don't react to messages already in the queue

        clientReadableStream.on('data', (response) => {
            // console.log('Data received')
            const obj = response.toObject()
            const payloadJson = obj.uplinkFrame?.phyPayloadJson
            if (!payloadJson) return
            const payload = JSON.parse(payloadJson)
            if (payload?.mhdr?.mType !== 'Proprietary') return //Proprietary
            if (!payload?.macPayload?.bytes) return  //Not our proprietary perhaps
            const buff = new Buffer(payload.macPayload.bytes, 'base64');
            const gatewayId = buff.toString('ascii');
            // console.log('gateway id middle part', gatewayId.substr(6,3))
            if (gatewayId.substr(6,3) !== 'fff'
                && gatewayId.substr(6,3) !== '01f'
                && gatewayId.substr(12,4) !== '4150') return //Not our proprietary perhaps
            const rec = {mic: payload?.mic, gatewayId, ts:Date.now()}
            obj.uplinkFrame.senderGateway = gatewayId
            this.payload.push(obj.uplinkFrame); this.payload.slice(0,99)
            //Not at startup
            if (Date.now() - this.startupTs > 10000) {
                console.log('Ping received')
                this.recs = [] //keep the last one
                this.recs.push(rec)
            }
        });
        clientReadableStream.on('error', (response)=>{
            console.log(response)
            console.log('Disconnected (error)!!!')
        });
        clientReadableStream.on('end', async (response)=>{
            console.log('Disconnected (end)!!!')
            console.log('Reconnecting!!! (10s sleep)')
            await this.sleep(10 * 1000)
            if (response.includes('authorized')) {
                if (this.apiUrl === config.chirpstack.apiUrl) {
                    this.apiUrl = config.chirpstack.apiUrlII
                }
                else {
                    this.apiUrl = config.chirpstack.apiUrl
                }
                this.gatewayServiceClient = new gatewayService.GatewayServiceClient(
                this.apiUrl,
                grpc.credentials.createInsecure()
            )
            this.streamEvents()
            }
        });
    }

    sendPing() {
        return new Promise((resolve, reject)=>{
            if (this.consNode) return resolve('')
            const sendPingRequest = new gatewayMessages.SendPingRequest()
            sendPingRequest.setGatewayId(config.chirpstack.gatewayId)
            this.gatewayServiceClient.sendPing(sendPingRequest, this.metadata, function (err, res) {
                if (err) {
                    console.log(err)
                    return resolve('')
                }
                try {
                    const MIC = new TextDecoder().decode(res.getMic());
                    return resolve(MIC)
                } catch (e) {
                    console.log(e)
                    return resolve('')
                }
            })
        })
    }

    getGatewayGPS(gatewayId) {
        return new Promise((resolve, reject)=>{
            const request = new gatewayMessages.GetGatewayRequest()
            request.setId(gatewayId)
            this.gatewayServiceClient.get(request, this.metadata, function (err, res) {
                if (err) {
                    // console.log(err)
                    return resolve({latitude:45.5251384, longitude:-122.8898411})
                }
                const gpsObject = res.getGateway().getLocation().toObject()
                // console.log(gpsObject)
                return resolve(gpsObject)
            })
        })
    }

    getRecs() {
        const recs = this.recs.filter(e => e.ts > Date.now() - 2 * 60 * 1000)
        return [...new Map(recs.map(item => [item['mic'], item])).values()]
    }

    getPayload() {
        this.payload = this.payload.sort((a,b) => (b.publishedAt.seconds - b.publishedAt.seconds))
        // for (let i in this.payload) {
        //     const str = ''+this.payload[i].rxInfoList[0].gatewayId
        //     console.log(str)
        //     const buff = new Buffer(str, 'base64');
        //     this.payload[i].rxInfoList[0].gatewayId = buff.toString('ascii');
        // }
        if (this.technical) return this.payload
        else return []
    }

    rmRecs() {
        this.recs = []
    }

    async sleep(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

}


module.exports = chirpstackService

// clientReadableStream.on('status', function(response){ //status, error, close
//     console.log('Disconnected (status)!!!', response)
// });
// clientReadableStream.on('end', function(response){ //status, error, close
//     console.log('Disconnected (end)!!!')
// });
// clientReadableStream.on('error', function(response){ //status, error, close
//     console.log('Disconnected (error)!!!', response)
// });
// const internalService = require('@crankk.io/chirpstack-api-fork/as/external/api/internal_grpc_pb')
// const internalMessages = require('@crankk.io/chirpstack-api-fork/as/external/api/internal_pb')

