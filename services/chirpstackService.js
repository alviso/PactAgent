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
            const obj = response.toObject()
            const payloadJson = obj.uplinkFrame?.phyPayloadJson
            console.log(obj.uplinkFrame)
            if (!payloadJson) return
            const payload = JSON.parse(payloadJson)
            if (payload?.mhdr?.mType !== 'Proprietary') return //Proprietary
            if (!payload?.macPayload?.bytes) return  //Not our proprietary perhaps
            const buff = new Buffer(payload.macPayload.bytes, 'base64');
            const gatewayIdMIC = buff.toString('ascii');
            if (gatewayIdMIC.length !== 16 && gatewayIdMIC.length !== 24) return //either just gw id or gw id plus MIC
            const gatewayId = gatewayIdMIC.substring(0,16)
            let mic = payload?.mic
            if (gatewayIdMIC.length === 24) mic = gatewayIdMIC.substring(16,24)
            // if (gatewayId.substr(6,3) !== 'fff'
            //     && gatewayId.substr(6,3) !== '01f'
            //     && gatewayId.substr(12,4) !== '4150') return //Not our proprietary perhaps
            const rec = {mic, gatewayId, ts:Date.now()}
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
            if (response?.code === 16) {
                if (this.apiUrl === config.chirpstack.apiUrl) {
                    this.apiUrl = config.chirpstack.apiUrl2
                } else {
                    this.apiUrl = config.chirpstack.apiUrl
                }
                this.gatewayServiceClient = new gatewayService.GatewayServiceClient(
                    this.apiUrl,
                    grpc.credentials.createInsecure()
                )
            }
            console.log('Disconnected (error)!!!')
        });
        clientReadableStream.on('end', async (response)=>{
            console.log('Disconnected (end)!!!')
            console.log('Reconnecting!!! (10s sleep)')
            await this.sleep(10 * 1000)
            this.streamEvents()
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
                    return resolve({latitude:45.5251384, longitude:-122.8898411})
                }
                const gpsObject = res.getGateway().getLocation().toObject()
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

