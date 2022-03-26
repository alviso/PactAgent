const config = require("../config.js");
const grpc = require('@grpc/grpc-js')
const internalService = require('@crankk.io/chirpstack-api-fork/as/external/api/internal_grpc_pb')
const internalMessages = require('@crankk.io/chirpstack-api-fork/as/external/api/internal_pb')
const gatewayService = require('@crankk.io/chirpstack-api-fork/as/external/api/gateway_grpc_pb')
const gatewayMessages = require('@crankk.io/chirpstack-api-fork/as/external/api/gateway_pb')
const Pact = require("pact-lang-api");

class chirpstackService {

    constructor() {

        this.recs = new Set()
        this.startupTs = Date.now()
        // Create the client for the 'internal' service
        this.internalServiceClient = new internalService.InternalServiceClient(
            config.chirpstack.apiUrl,
            grpc.credentials.createInsecure()
        );

        this.metadata = {}

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
            const obj = response.toObject()
            const payloadJson = obj.uplinkFrame?.phyPayloadJson
            if (!payloadJson) return
            const payload = JSON.parse(payloadJson)
            if (payload?.mhdr?.mType !== 'Proprietary') return
            const buff = new Buffer(payload.macPayload.bytes, 'base64');
            const gatewayId = buff.toString('ascii');
            const rec = {mic: payload?.mic, gatewayId}
            //Not at startup
            if (Date.now() - this.startupTs > 1000) {
                this.recs.add(rec)
            }
        });
        clientReadableStream.on('end', function(response){ //status, error, close
            console.log('Disconnected!!!')
        });
        clientReadableStream.on('error', function(response){ //status, error, close
            console.log('Disconnected!!!')
        });


    }

    sendPing() {
        return new Promise((resolve, reject)=>{
            const sendPingRequest = new gatewayMessages.SendPingRequest()
            sendPingRequest.setGatewayId(config.chirpstack.gatewayId)
            this.gatewayServiceClient.sendPing(sendPingRequest, this.metadata, function (err, res) {
                try {
                    const MIC = new TextDecoder().decode(res.getMic());
                    resolve(MIC)
                } catch (e) {
                    console.log(e)
                    resolve('')
                }
            })
        })
    }

    removeRec(rec) {
        this.recs.delete(rec)
    }

    getRecs() {
        return this.recs
    }


}


module.exports = chirpstackService
