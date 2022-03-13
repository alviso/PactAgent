const config = require("../config.js");
const grpc = require('@grpc/grpc-js')
const internalService = require('@crankk.io/chirpstack-api-fork/as/external/api/internal_grpc_pb')
const internalMessages = require('@crankk.io/chirpstack-api-fork/as/external/api/internal_pb')
const gatewayService = require('@crankk.io/chirpstack-api-fork/as/external/api/gateway_grpc_pb')
const gatewayMessages = require('@crankk.io/chirpstack-api-fork/as/external/api/gateway_pb')
const Pact = require("pact-lang-api");

class chirpstackService {

    constructor() {

        this.mics = new Set()
        // Create the client for the 'internal' service
        this.internalServiceClient = new internalService.InternalServiceClient(
            config.chirpstack.apiUrl,
            grpc.credentials.createInsecure()
        );

// Create and build the login request message
        const loginRequest = new internalMessages.LoginRequest();

        loginRequest.setEmail(config.chirpstack.email);
        loginRequest.setPassword(config.chirpstack.password);

        this.metadata = {}

// Send the login request
        this.internalServiceClient.login(loginRequest, (error, response) => {
            // Build a gRPC metadata object, setting the authorization key to the JWT we
            // got back from logging in.
            this.metadata = new grpc.Metadata();
            this.metadata.set('authorization', response.getJwt());

            // This metadata can now be passed for requests to APIs that require authorization
            // e.g.
            // deviceServiceClient.create(createDeviceRequest, metadata, callback);
            this.gatewayServiceClient = new gatewayService.GatewayServiceClient(
                config.chirpstack.apiUrl,
                grpc.credentials.createInsecure()
            )

            const streamFrameLogsRequest = new gatewayMessages.StreamGatewayFrameLogsRequest()
            streamFrameLogsRequest.setGatewayId(config.chirpstack.gatewayId)

            const clientReadableStream = this.gatewayServiceClient.streamFrameLogs(streamFrameLogsRequest, this.metadata)

            clientReadableStream.on('data', function(response){
                const obj = response.toObject()
                const payloadJson = obj.uplinkFrame?.phyPayloadJson
                if (!payloadJson) return
                const payload = JSON.parse(payloadJson)
                if (payload?.mhdr?.mType !== 'Proprietary') return
                console.log(payload)
            });
            clientReadableStream.on('end', function(response){ //status, error, close
                console.log('Disconnected!!!')
            });

            setInterval(async ()=>{
                this.internalServiceClient.login(loginRequest, (error, response) => {
                    this.metadata = new grpc.Metadata();
                    this.metadata.set('authorization', response.getJwt());
                })
            }, 20 * 60 * 60 * 1000);

        })

        setInterval(async ()=>{
            await this.sendPing()
        }, 1 * 60 * 1000);

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


}


module.exports = chirpstackService
