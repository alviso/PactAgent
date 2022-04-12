const config = require("../config.js");
const grpc = require('@grpc/grpc-js')
const gatewayService = require('@crankk.io/chirpstack-api-fork/as/external/api/gateway_grpc_pb')
const gatewayMessages = require('@crankk.io/chirpstack-api-fork/as/external/api/gateway_pb')

class chirpstackService {

    constructor() {
        this.streamEvents()
    }

    streamEvents() {
        this.recs = []
        this.startupTs = Date.now()
        this.metadata = new grpc.Metadata();
        this.metadata.set('authorization', config.chirpstack.apiKey);

        this.gatewayServiceClient = new gatewayService.GatewayServiceClient(
            config.chirpstack.apiUrl,
            grpc.credentials.createInsecure()
        )

        const streamFrameLogsRequest = new gatewayMessages.StreamGatewayFrameLogsRequest()
        streamFrameLogsRequest.setGatewayId(config.chirpstack.gatewayId)

        const clientReadableStream = this.gatewayServiceClient.streamFrameLogs(streamFrameLogsRequest, this.metadata)

        clientReadableStream.on('data', (response) => {
            console.log('Data received')
            const obj = response.toObject()
            const payloadJson = obj.uplinkFrame?.phyPayloadJson
            if (!payloadJson) return
            const payload = JSON.parse(payloadJson)
            if (payload?.mhdr?.mType !== 'Proprietary') return
            if (!payload?.macPayload?.bytes) return  //Not our proprietary perhaps
            const buff = new Buffer(payload.macPayload.bytes, 'base64');
            const gatewayId = buff.toString('ascii');
            const rec = {mic: payload?.mic, gatewayId}
            //Not at startup
            if (Date.now() - this.startupTs > 1000) {
                this.recs.push(rec)
            }
        });
        clientReadableStream.on('error', (response)=>{
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
                    console.log(err)
                    return resolve('')
                }
                const gpsObject = res.getGateway().getLocation().toObject()
                console.log(gpsObject)
                return resolve(gpsObject)
            })
        })
    }

    getRecs() {
        return [...new Map(this.recs.map(item => [item['mic'], item])).values()]
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

